/***********************************************************************
* retro-g15/emulator Drum.js
************************************************************************
* Copyright (c) 2021, Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* JavaScript class module for the G-15 drum and system timing.
*
* Drum supports two timing mechanisms, the main one for the Processor,
* and an auxilliary one for the I/O subsystem. I/O timing is initialized
* to the main timing at the start of an I/O, but operates asynchronously
* during the I/O. This allows the emulator to simulate, to a degree, the
* asynchronous nature of G-15 I/O.
************************************************************************
* 2021-12-08  P.Kimpel
*   Original version.
***********************************************************************/

export {Drum}

import * as Util from "./Util.js";
import {Register} from "./Register.js";
import {WaitSignal} from "./WaitSignal.js";


class Drum {

    static minThrottleDelay =           // minimum time to accumulate throttling delay, >= 4ms
            Util.minTimeout+1;
    static cmMask = 0x7F;               // mask for the 7-bit counters in the CM register

    static computeDrumCount(L, T) {
        /* Computes and returns the number of word-times the drum must traverse
        from word-time L to word-time T. If L=T, returns zero. This works a
        little weird, because the word-time is a 7-bit number and the G-15
        counted to T by computing the difference between L and T in an unsigned
        7-bit field in the Command Register (CM), then incrementing that field
        until it overflowed at 128. If the count would cross words 107->0,
        however, the register would be incremented by an additional 20 to
        account for the fact that a 7-bit register counts up to 127, but on the
        drum, the word following 107 is 0, not 108 (which is 128-20). In some
        cases, adding the 20 would overflow the CM field immediately, which
        would stop the traversal at that point, i.e., word-time 0 */
        const cm = ((~T & Drum.cmMask) + L) & Drum.cmMask;

        if (L + Drum.cmMask-cm < Util.longLineSize) {   // The easy case... does not cross 107->0
          return Drum.cmMask - cm;
        } else {                                        // Traversal crosses 107->0
            if (cm+20 < Drum.cmMask && L + Drum.cmMask - (cm+20) > Util.longLineSize) {
                // Adding 20 does not overflow CM, so compute word-times.
                return Drum.cmMask - (cm+20) & Drum.cmMask;
            } else {
                // Adding 20 does overflow CM, so traversal will stop at WT 0.
                return Util.longLineSize - L;
            }
        }
    }

    constructor() {
        /* Constructor for the G-15 drum object, including the drum-based registers */
        let drumOffset = 0;
        let size = 0;
        const drumWords = 20*Util.longLineSize +        // 20x108 word long lines
                          4*Util.fastLineSize +         // 4x4 word fast lines
                          Util.fastLineSize +           // 1x4 word MZ I/O buffer line
                          Util.longLineSize;            // 1x108 word CN number track

        const buildRegisterArray = (length, bits, invisible) => {
            let a = [];                 // the register array

            for (let x=0; x<length; ++x) {
                a.push(new Register(bits, this, invisible));
            }

            return a;
        };

        // System timing and synchronization variables.
        this.eTime = 0;                 // current emulation time, ms
        this.eTimeSliceEnd = 0;         // current timeslice end emulation time, ms
        this.runTime = 0;               // total accumulated run time, ms
        this.drumTime = 0;              // drum clock in word-times
        this.timingActive = false;      // true if the timing mechanism is active
        this.stepWait = null;           // Promise used by stepDrum() to serialize stepping
        this.drumTimer = new Util.Timer();
        this.line19Timer = new Util.Timer();

        this.procActive = false;        // true if the Processor is currently running
        this.procSync = new WaitSignal();
        this.boundProcProceed = this.procSync.proceed.bind(this.procSync);

        this.ioActive = false;          // true if I/O is currently running
        this.ioCanceled = false;        // true if I/O has been canceled by Processor
        this.ioSync = new WaitSignal();
        this.boundIOProceed = this.ioSync.proceed.bind(this.ioSync);

        // Drum storage and line layout.
        this.drum = new ArrayBuffer(drumWords*Util.wordBytes);  // Drum: 32-bit Uint words
        this.line = new Array(33);
        this.L = new Register(7, this, false);  // current drum rotational position: word-time 0-107

        // Build the long lines, 108 words each
        size = Util.longLineSize*Util.wordBytes;
        for (let x=0; x<20; ++x) {
            this.line[x] = new Uint32Array(this.drum, drumOffset, Util.longLineSize);
            drumOffset += size;
        }

        // Build the fast lines, 4 words each.
        size = Util.fastLineSize*Util.wordBytes;
        for (let x=20; x<24; ++x) {
            this.line[x] = new Uint32Array(this.drum, drumOffset, Util.fastLineSize);
            drumOffset += size;
        }

        // Build the 108-word Number Track.
        size = Util.longLineSize*Util.wordBytes;
        this.CN = new Uint32Array(this.drum, drumOffset, Util.longLineSize);
        drumOffset += size;

        // Build the double-precision registers (not implemented as part of the drum array).
        this.line[24] = this.MQ = buildRegisterArray(2, Util.wordBits, false);   // was: new Uint32Array(this.drum, drumOffset, 2);
        this.line[25] = this.ID = buildRegisterArray(2, Util.wordBits, false);   // was: new Uint32Array(this.drum, drumOffset, 2);
        this.line[26] = this.PN = buildRegisterArray(2, Util.wordBits, false);   // was: new Uint32Array(this.drum, drumOffset, 2);
        this.line[27] = null;           // TEST register, not actually on the drum

        // Build the one-word registers (not implemented here as part of the drum array).
        this.line[28] = this.AR = new Register(Util.wordBits, this, false);
        this.CM = new Register(Util.wordBits, this, false);
        this.line[29] = null;
        this.line[30] = null;
        this.line[31] = null;

        // Build the four-word MZ I/O buffer line.
        size = Util.fastLineSize*Util.wordBytes;
        this.line[32] = this.MZ = new Uint32Array(this.drum, drumOffset, Util.fastLineSize);
        drumOffset += size;
    }

    /**************************************/
    get CE() {
        /* Returns 1 if at an even word, 0 if odd */

        return 1 - this.L.value % 2;
    }

    /**************************************/
    get L2() {
        /* Returns the current word-time for two-word registers */

        return this.L.value % 2;
    }

    /**************************************/
    get L4() {
        /* Returns the current word-time for four-word lines */

        return this.L.value % Util.fastLineSize;
    }

    /**************************************/
    startTiming() {
        /* Initializes the drum and emulation timing. The Math.max() is used
        to compensate for many browsers limiting the precision of
        performance.now() to one millisecond, which can make real time appear
        to go backwards */

        if (this.timingActive) {
            debugger;
        } else {
            const now = performance.now();
            this.timingActive = true;
            while (this.runTime >= 0) {
                this.runTime -= now;
            }

            if (Math.floor(now/Util.wordTime) > Math.floor(this.eTime/Util.wordTime)) {
                this.eTime = now;
            } else {
                this.eTime += Util.wordTime;
            }

            this.eTimeSliceEnd = this.eTime + Drum.minThrottleDelay;
            this.L.value = Math.floor(this.eTime/Util.wordTime) % Util.longLineSize;
        }
    }

    /**************************************/
    stopTiming() {
        /* Stops the run timer */

        if (!this.timingActive) {
            debugger;
        } else {
            const now = performance.now();
            this.timingActive = false;
            while (this.runTime < 0) {
                this.runTime += now;
            }
        }
    }

    /**************************************/
    async stepDrum() {
        /* Steps the drum to its next word-time and updates the timing.
        Returns either immediately or after a delay to allow browser real time
        to catch up with the emulation clock, this.eTime. Since most browsers
        will force a setTimeout() to wait for a minimum of 4ms, this routine
        will not delay if emulation time has not yet reached the end of its
        time slice */

        // If a step is already in progress, complain.
        if (this.stepWait) {
            throw new Error("Drum stepDrum called during stepping");
        }

        // Determine if it's time slow things down to real time.
        if ((this.eTime += Util.wordTime) < this.eTimeSliceEnd) {
            this.stepWait = Promise.resolve();  // i.e., don't wait at all
        } else {
            this.eTimeSliceEnd += Drum.minThrottleDelay;
            this.stepWait = this.drumTimer.delayUntil(this.eTime);
        }

        ++this.drumTime;
        this.L.value = (this.L.value + 1) % Util.longLineSize;

        await this.stepWait;
        this.stepWait = null;
    }

    /**************************************/
    tracePrecession(code, word, caption) {
        /* Log I/O precession activity to the console */
        const drumLoc = Util.formatDrumLoc(77, this.L.value, true);

        console.debug("<I/O PREC>" +
                    `${this.drumTime.toFixed().padStart(9)}: ${drumLoc}  ${code.toString(16)}, ${Util.g15SignedHex(word)} ${caption}`);
    }


    /*******************************************************************
    *  Processor Drum Methods                                          *
    *******************************************************************/

    /**************************************/
    async procStart() {
        /* Initializes the drum and emulation timing for I/O */

        if (this.procActive || this.procSync.waiting) {
            console.debug(`<<< procStart: active=${this.procActive}, waiting=${this.procSync.waiting}`);
            debugger;
        }

        if (!this.procActive) {
            this.procActive = true;
            if (!this.timingActive) {
                this.startTiming();
            }

            // If stepDrum is currently in progress, wait for it to finish.
            if (this.stepWait) {
                await this.stepWait;
            }
        }
    }

    /**************************************/
    procStop() {
        /* Disables drum timing for the Processor */

        if (!this.procActive || this.procSync.waiting) {
            console.debug(`<<< procStop: active=${this.procActive}, waiting=${this.procSync.waiting}, IO active=${this.ioActive}, IO waiting=${this.ioSync.waiting}`);
            debugger;
        }

        if (this.procActive) {
            this.procActive = false;
            if (this.procSync.waiting) {
                debugger;
                console.debug("<<< procStop: procSync was waiting");
                this.procSync.proceed();
            }

            if (this.ioSync.waiting) {          // I/O is waiting for us to step
                this.stepDrum().then(this.boundIOProceed);
            }

            if (!this.ioActive) {
                this.stopTiming();
            }
        }
    }

    /**************************************/
    async waitFor(wordTimes) {
        /* Simulates waiting for the drum to rotate through the specified number
        of word-times, which must be non-negative. Steps one word-time at a
        time, synchronizing with stepping for I/O. this.stepDrum will update
        this.L and the timing, and will throttle performance as necessary */
        let i = wordTimes;

        while (--i >= 0) {
            if (!this.procActive) {             // if proc stopped, just quit
                debugger;
                break;
            } else if (!this.ioActive) {        // I/O not active, so just step
                await this.stepDrum();
            } else if (this.ioSync.waiting) {   // I/O is waiting for us to step
                await this.stepDrum();
                this.ioSync.proceed();
            } else {                            // we need to wait for I/O to step
                await this.procSync.wait();
            }
        }
    }

    /**************************************/
    async waitUntil(wordTime) {
        /* Simulates waiting for the drum to rotate to the specified word-time.
        Updates the drum location and the emulation clock via waitFor().
        Word-times must be non-negative and < 128.  */
        const count = Drum.computeDrumCount(this.L.value, wordTime);

        if (count > 0) {                // if we're already there, do nothing
            await this.waitFor(count);
        }
    }

    /**************************************/
    read(lineNr) {
        /* Reads a word transparently from drum line "lineNr" at the current
        location, this.L. Reads from lines 27, 29, 30, 31 return null since those
        are not storage lines but special functions */

        if (lineNr < 20) {
            return this.line[lineNr][this.L.value];
        } else if (lineNr < 24) {
            return this.line[lineNr][this.L4];
        } else {
            switch (lineNr) {
            case 24:
                return this.MQ[this.L2].value;
                break;
            case 25:
                return this.ID[this.L2].value;
                break;
            case 26:
                return this.PN[this.L2].value;
                break;
            case 28:
                return this.AR.value;
                break;
            default:
                return null;            // special registers not on the drum
                break;
            }
        }
    }

    /**************************************/
    write(lineNr, word) {
        /* Writes a word transparently to drum line "lineNr" at the current
        location, this.L. Writes to lines 27, 29, 30, 31 are ignored */

        if (word < 0 || word > Util.wordMask) {
            debugger;
        }

        if (lineNr < 20) {
            this.line[lineNr][this.L.value] = word;
        } else if (lineNr < 24) {
            this.line[lineNr][this.L4] = word;
        } else {
            switch (lineNr) {
            case 24:
                this.MQ[this.L2].value = word;
                break;
            case 25:
                this.ID[this.L2].value = word;
                break;
            case 26:
                this.PN[this.L2].value = word;
                break;
            case 28:
                this.AR.value = word;
                break;
            default:
                break;
            }
        }
    }

    /**************************************/
    readCN() {
        /* Reads a word transparently from the number track (CN) at the current
        location, this.L */

        return this.CN[this.L.value];
    }

    /**************************************/
    writeCN(word) {
        /* Writes a word transparently to the number track (CN) at the current
        location, this.L */

        if (word < 0 || word > Util.workMask) {
            debugger;
        }

        this.CN[this.L.value] = word;
    }

    /**************************************/
    getID1T1Bit() {
        /* Returns the value of the low-order (T1) bit of ID:1 (odd word) */

        return this.ID[1].value & 1;
    }

    /**************************************/
    setMQ0T2Bit(bit) {
        /* Sets the T2 (low-order magnitude) bit of MQ:0 (even word). This is
        used after division to apply quotient bits and Princeton Rounding to
        the quotient */

        this.MQ[0].setBit(1, bit);
    }

    /**************************************/
    getMQ0T29Bit() {
        /* Returns the value of the high-order (T29) bit of MQ:0 (even word) */

        return (this.MQ[0].value >> (Util.wordBits-1)) & 1;
    }

    /**************************************/
    getMQ1T29Bit() {
        /* Returns the value of the high-order (T29) bit of MQ:1 (odd word) */

        return (this.MQ[1].value >> (Util.wordBits-1)) & 1;
    }

    /**************************************/
    getPN0T1Bit() {
        /* Returns the value of the sign bit of PN:0 (even word) */

        return this.PN[0] & Util.wordSignMask;
    }

    /**************************************/
    setPN0T1Bit(sign) {
        /* Sets the sign bit in the even word of PN. This is used after an
        addition or subtraction to PN to set the final sign of the operation.
        It's a bit of a kludge, but the way PN works is a bit of a kludge,
        anyway. Unlike the other drum read/write routines, it ignores L and
        operates on this.PN[0] unconditionally */

        this.PN[0].setBit(0, sign);
    }

    /**************************************/
    flipPN0T1Bit() {
        /* Flips the sign bit in the even word of PN. This is used during
        divison */

        this.PN[0].flipBit(0);
    }

    /**************************************/
    getPN0T29Bit() {
        /* Returns the value of the high-order (T29) bit of PN:0 (even word) */

        return (this.PN[0].value >> (Util.wordBits-1)) & 1;
    }


    /*******************************************************************
    *  I/O Subsystem Drum Methods                                      *
    *******************************************************************/

    /**************************************/
    async ioStart(caption) {
        /* Initializes the drum and emulation timing for I/O */

        if (this.ioActive || this.ioSync.waiting) {
            console.debug(`<<< ioStart ${caption}: active=${this.ioActive}, waiting=${this.ioSync.waiting}`);
            debugger;
        }

        if (!this.ioActive) {
            this.ioActive = true;
            if (!this.timingActive) {
                this.startTiming();
            }

            // If stepDrum is currently in progress, wait for it to finish.
            if (this.stepWait) {
                await this.stepWait;
            }
        }
    }

    /**************************************/
    ioStop(caption) {
        /* Disables drum timing for I/O */

        if (!this.ioActive /*|| this.ioSync.waiting*/) {
            console.debug(`<<< ioStop ${caption}: active=${this.ioActive}, waiting=${this.ioSync.waiting}, Proc active=${this.procActive}, Proc waiting=${this.procSync.waiting}`);
            debugger;
        }

        if (this.ioActive) {
            this.ioActive = false;
            this.ioCanceled = false;
            if (this.ioSync.waiting) {
                console.debug(`<<< IO Stop ioSync waiting, ${caption}`);
                debugger;
                this.ioSync.proceed();
            }

            if (this.procSync.waiting) {        // Processor is waiting for us to step
                this.stepDrum().then(this.boundProcProceed);
            }

            if (!this.procActive) {
                this.stopTiming();
            }
        }
    }

    /**************************************/
    ioCancel() {
        /* Called by Processor to cancel the current I/O */

        if (this.ioActive) {
            this.ioCanceled = true;
        }
    }

    /**************************************/
    async ioWaitFor(wordTimes) {
        /* Simulates waiting for the drum to rotate through the specified number
        of word-times, which must be non-negative. Steps one word-time at a
        time, synchronizing with stepping for the Processor. this.stepDrum will
        update this.L and the timing, and will throttle performance as necessary */
        let i = wordTimes;

        while (--i >= 0) {
            if (!this.ioActive) {               // if I/O stopped, just quit
                debugger;
                break;
            } else if (this.ioCanceled) {
                break;
            } else if (!this.procActive) {      // Processor not active, so just step
                await this.stepDrum();
            } else if (this.procSync.waiting) { // Processor is waiting for us to step
                await this.stepDrum();
                this.procSync.proceed();
            } else {                            // we need to wait for Processor to step
                await this.ioSync.wait();
            }
        }
    }

    /**************************************/
    async ioWaitUntil(wordTime) {
        /* Simulates waiting for the drum to rotate to the specified word-time.
        Updates the drum location and the emulation clock via waitFor().
        Word-times must be non-negative and < 128 */
        const count = Drum.computeDrumCount(this.L.value, wordTime);

        if (count > 0) {                // if we're already there, do nothing
            await this.ioWaitFor(count);
        }
    }

    /**************************************/
    async ioWaitUntil4(wordTime) {
        /* Simulates waiting for the drum to rotate to the specified word
        location on a 4-word line. Locations must be non-negative. Updates
        the I/O drum location and clock via waitFor() */
        let words = (wordTime - this.L.value + Util.longLineSize) % Util.fastLineSize;

        if (words > 0) {
            await this.ioWaitFor(words);
        }
    }

    /**************************************/
    ioRead19() {
        /* Reads a word transparently from drum line 19 at the current location */

        return this.line[19][this.L.value];
    }

    /**************************************/
    ioWrite19(word) {
        /* Writes a word transparently to drum line 19 at the current location */

        if (word < 0 || word > Util.workMask) {
            debugger;
        }

        this.line[19][this.L.value] = word;
    }

    /**************************************/
    ioRead23() {
        /* Reads a word transparently from drum line 23 at the current location */

        return this.line[23][this.L4];
    }

    /**************************************/
    ioWrite23(word) {
        /* Writes a word transparently to drum line 23 at the current location */

        if (word < 0 || word > Util.wordMask) {
            debugger;
        }

        this.line[23][this.L4] = word;
    }

    /**************************************/
    ioReadMZ() {
        /* Reads a word transparently from the I/O buffer MZ at the current
        location */

        return this.MZ[this.L4];
    }

    /**************************************/
    ioWriteMZ(word) {
        /* Writes a word transparently to the I/O buffer MZ at the current
        location */

        if (word < 0 || word > Util.wordMask) {
            debugger;
        }

        this.MZ[this.L4] = word;
    }

    /**************************************/
    async ioPrecessARToCode(bits) {
        /* Precesses the original contents of AR (line 28) by "bits" bits,
        inserting zero in the "bits" low-order bits of the word, and returning
        the original "bits" high order bits of the word and a Boolean that is
        always false (to make the return value signature identical to
        ioPrecess19ToCode). Always starts a precession at T0. This is normally
        used to get the next data code from AR for output */
        let keepBits = Util.wordBits - bits;
        let keepMask = Util.wordMask >> bits;

        await this.ioWaitUntil(0);      // start precession at T0
        let word = this.read(28);
        if (word < 0 || word > Util.wordMask) {
            debugger;
        }

        let code = word >> keepBits;
        if (!this.ioCanceled) {
            this.write(28, (word & keepMask) << bits);
            await this.ioWaitFor(1);
        }
        return [code, false];
    }

    /**************************************/
    async ioPrecessMZTo19() {
        /* Precesses all of line MZ to line 19, leaving the original contents
        of MZ in words 0-3 of 19, precessing the original contents of line 19
        by four words to higher addresses in the line, and leaving the original
        contents of words 104-107 of line 19 in line MZ. Since this operation
        can run concurrently with other I/O-based drum operations, it doesn't
        use the regular ioReadX or ioWriteX routines or this.ioWait* routines */

        // Compute delay until line 19 word 0.
        let delay = Drum.computeDrumCount(this.L.value, 0)*Util.wordTime;

        for (let x=0; x<Util.longLineSize; ++x) {
            if (this.ioCanceled) {
                delay = 0;
                break;
            }

            // Synchronize drum timing
            if (delay > Drum.minThrottleDelay) {
                await this.line19Timer.set(delay);
                delay = 0;
            }

            let mx = x % Util.fastLineSize;
            [this.line[19][x], this.MZ[mx]] = [this.MZ[mx], this.line[19][x]];
            delay += Util.wordTime;
        }

        await this.line19Timer.set(delay);
    }

    /**************************************/
    ioDetect19Sign107() {
        /* Returns the state of the sign bit in word 107 of line 19. This is
        intended to be used to set the OS flip flop during formatted output.
        The G-15 apparently monitored this and set the OS flip flop
        asynchronously during SLOW-OUT operations every time word 107 (which
        holds the word currently being precessed out of line 19) passed the
        read heads. We can't easily do that in this emulator, so the SLOW-OUT
        formatters need to call this routine BEFORE applying formatting to a
        digit, because after precession the sign bit will have shifted left */

        return this.line[19][Util.longLineSize-1] & Util.wordSignMask;
    }

    /**************************************/
    async ioPrecessMZToCode(bits) {
        /* Precesses the original contents of MZ by "bits" bits to higher
        word numbers, inserting zero in the "bits" low-order bits of word 0,
        and returning the original "bits" high order bits of word 3. Always
        starts a precession at T0. This is normally used to get the next 3-bit
        format code for slow output */
        let keepBits = Util.wordBits - bits;
        let keepMask = Util.wordMask >> bits;
        let code = 0;
        let word = 0;

        await this.ioWaitUntil(0);      // start precession at T0
        for (let x=0; x<Util.fastLineSize; ++x) {
            if (this.ioCanceled) {
                code = 0;
                break;
            }

            word = this.ioReadMZ();
            if (word < 0 || word > Util.wordMask) {
                debugger;
            }

            this.ioWriteMZ(((word & keepMask) << bits) | code);
            code = word >> keepBits;
            await this.ioWaitFor(1);
        }

        return code;
    }

    /**************************************/
    async ioPrecessLongLineToMZ(line, bits) {
        /* Precesses the original contents of words 0-3 of the specified long
        line to MZ by "bits" bits, inserting zero in the "bits" low-order bits of
        MZ word 0, and returning the original "bits" high order bits of word 3
        from the long line. This is normally used to load MZ from the long line
        and return the first 3-bit format code for slow output */
        let keepBits = Util.wordBits - bits;
        let keepMask = Util.wordMask >> bits;
        let code = 0;
        let word = 0;

        await this.ioWaitUntil(0);      // start precession at T0
        for (let x=0; x<Util.fastLineSize; ++x) {
            if (this.ioCanceled) {
                code = 0;
                break;
            }

            word = this.read(line);
            if (word < 0 || word > Util.wordMask) {
                debugger;
            }

            this.ioWriteMZ(((word & keepMask) << bits) | code);
            code = word >> keepBits;
            await this.ioWaitFor(1);
        }

        return code;
    }

    /**************************************/
    async ioInitialize23ForAutoReload() {
        /* Initializes line 23 for auto reload. Sets the T1 bit of word 0 in
        line 23 and zeroes the remaining bits of the line */

        await this.ioWaitUntil4(0);
        for (let x=0; x<Util.fastLineSize; ++x) {
            if (this.ioCanceled) {
                break;
            }

            this.ioWrite23(x == 0 ? 1 : 0);
            await this.ioWaitFor(1);
        }
    }

    /**************************************/
    async ioCopy23ToMZ(autoReload) {
        /* Copies the four words of line 23 to MZ, freeing 23 for more input.
        If "autoReload" is truthy, sets the T1 bit of word 0 in line 23 and
        zeroes the remaining bits of the line instead of "recirculating" them */

        await this.ioWaitUntil4(0);
        for (let x=0; x<Util.fastLineSize; ++x) {
            if (this.ioCanceled) {
                break;
            }

            this.ioWriteMZ(this.ioRead23());
            if (autoReload) {
                this.ioWrite23(x == 0 ? 1 : 0);
            }
            await this.ioWaitFor(1);
        }
    }

    /**************************************/
    async ioPrecess19ToCode(bits) {
        /* Precesses the original contents of line 19 by "bits" bits to higher
        word numbers, inserting zero in the "bits" low-order bits of word 0, and
        returning the original "bits" high order bits of word 107 and a Boolean
        indicating whether line 19 is now "empty" (all zeroes). This is
        normally used to get the next data code from line 19 for output */
        let keepBits = Util.wordBits - bits;
        let keepMask = Util.wordMask >> bits;
        let code = 0;
        let empty = true;
        let newWord = 0;
        let word = 0;

        await this.ioWaitUntil(0);      // start precession at T0
        for (let x=0; x<Util.longLineSize; ++x) {
            if (this.ioCanceled) {
                code = 0;
                empty = true;
                break;
            }

            word = this.ioRead19();
            if (word < 0 || word > Util.wordMask) {
                debugger;
            }

            newWord = ((word & keepMask) << bits) | code;
            if (newWord) {
                empty = false;
            }

            this.ioWrite19(newWord);
            code = word >> keepBits;
            await this.ioWaitFor(1);
        }

        return [code, empty];
    }

    /**************************************/
    async ioPrecess19ToMZ() {
        /* Precesses the high-order 4 words of line 19 to MZ and zeroes into the
        low-order words of line 19. This is normally used by canceling an I/O to
        get the 4-word precession as a side effect */
        let word = 0;

        await this.ioWaitUntil(0);      // start precession at T0
        for (let x=0; x<Util.longLineSize; ++x) {
            word = this.ioRead19();
            if (word < 0 || word > Util.wordMask) {
                debugger;
            }

            this.ioWrite19(x < Util.fastLineSize ? 0 : this.ioReadMZ());
            this.ioWriteMZ(word);
            await this.ioWaitFor(1);
        }
    }

    /**************************************/
    async ioPrecessCodeTo23(code, bits) {
        /* Stores the value of "code" into the low-order "bits" of line 23
        word 0, precessing the original contents of line 23 to higher word
        numbers and returning the high-order "bits" number of bits from line
        23 word 3. This will normally be called 29 times to fully populate
        line 23 before doing a Reload operation */
        let keepBits = Util.wordBits - bits;
        let keepMask = Util.wordMask >> bits;
        let codeMask = Util.wordMask >> keepBits;
        let carry = code & codeMask;
        let word = 0;

        await this.ioWaitUntil4(0);
        for (let x=0; x<Util.fastLineSize; ++x) {
            if (this.ioCanceled) {
                break;
            }

            word = this.ioRead23();
            if (word < 0 || word > Util.wordMask) {
                debugger;
            }

            this.ioWrite23(((word & keepMask) << bits) | carry);
            carry = word >> keepBits;
            await this.ioWaitFor(1);
        }

        return carry;
    }

} // class Drum
