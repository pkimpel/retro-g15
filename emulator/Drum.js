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
* during the I/O. This allows the emulator to sumulate, to a degree, the
* asynchronous nature of G-15 I/O.
************************************************************************
* 2021-12-08  P.Kimpel
*   Original version.
***********************************************************************/

export {Drum}

import * as Util from "./Util.js";
import {Register} from "./Register.js";


class Drum {

    constructor() {
        /* Constructor for the G-15 drum object, including the drum-based registers */
        let drumOffset = 0;
        let size = 0;
        const drumWords = 20*Util.longLineSize +        // 20x108 word long lines
                          4*Util.fastLineSize +         // 4x4 word fast lines
                          4 +                           // 1x4 word MZ I/O buffer line
                          Util.longLineSize;            // 1x108 word CN number track

        let buildRegisterArray = (length, bits, invisible) => {
            let a = [];                 // the register array

            for (let x=0; x<length; ++x) {
                a.push(new Register(bits, this, invisible));
            }

            return a;
        };

        // Main system timing variables
        this.eTime = 0;                 // current emulation time, ms
        this.eTimeSliceEnd = 0;         // current timeslice end emulation time, ms
        this.L = new Register(7, this, false);  // current drum rotational position: word-time 0-107
        this.drumTimer = new Util.Timer();

        // I/O subsystem timing variables
        this.ioTime = 0;                // current I/O emulation time, ms
        this.ioL = new Register(7, this, false);// current I/O drum rotational position
        this.ioTimer = new Util.Timer();
        this.line19Timer = new Util.Timer();

        // Drum storage and line layout
        this.drum = new ArrayBuffer(drumWords*Util.wordBytes);  // Drum: 32-bit Uint words
        this.line = new Array(33);

        // Build the long lines, 108 words each
        size = Util.longLineSize*Util.wordBytes;
        for (let x=0; x<20; ++x) {
            this.line[x] = new Uint32Array(this.drum, drumOffset, Util.longLineSize);
            drumOffset += size;
        }

        // Build the fast lines, 4 words each
        size = Util.fastLineSize*Util.wordBytes;
        for (let x=20; x<24; ++x) {
            this.line[x] = new Uint32Array(this.drum, drumOffset, Util.fastLineSize);
            drumOffset += size;
        }

        // Build the 108-word Number Track
        size = Util.longLineSize*Util.wordBytes;
        this.CN = new Uint32Array(this.drum, drumOffset, Util.longLineSize);
        drumOffset += size;

        // Build the double-precision registers (not implemented as part of the drum array)
        this.line[24] = this.MQ = buildRegisterArray(2, Util.wordBits, false);   // was: new Uint32Array(this.drum, drumOffset, 2);
        this.line[25] = this.ID = buildRegisterArray(2, Util.wordBits, false);   // was: new Uint32Array(this.drum, drumOffset, 2);
        this.line[26] = this.PN = buildRegisterArray(2, Util.wordBits, false);   // was: new Uint32Array(this.drum, drumOffset, 2);
        this.line[27] = null;           // TEST register, not actually on the drum

        // Build the one-word registers (not implemented here as part of the drum array)
        this.line[28] = this.AR = new Register(Util.wordBits, this, false);
        this.CM = new Register(Util.wordBits, this, false);
        this.line[29] = null;
        this.line[30] = null;
        this.line[31] = null;

        // Build the four-word MZ I/O buffer line
        size = 4*Util.wordBytes;
        this.line[32] = this.MZ = new Uint32Array(this.drum, drumOffset, 4);
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

        this.eTime = Math.max(performance.now(), this.eTime);
        this.eTimeSliceEnd = this.eTime + Drum.minDelayTime;
        this.L.value = Math.round(this.eTime/Util.wordTime) % Util.longLineSize;
    }

    /**************************************/
    throttle() {
        /* Returns a promise that unconditionally resolves after a delay to
        allow browser real time to catch up with the emulation clock, this.eTime.
        Since most browsers will force a setTimeout() to wait for a minimum of
        4ms, this routine will not delay if emulation time has not yet reached
        the end of its time slice or the difference between real time (as
        reported by performance.now()) and emulation time is less than
        Util.minTimeout */

        if (this.eTime < this.eTimeSliceEnd) {
            return Promise.resolve(null);       // i.e., don't wait at all
        } else {
            this.eTimeSliceEnd += Drum.minDelayTime;
            return this.drumTimer.delayUntil(this.eTime);
        }
    }

    /**************************************/
    waitFor(wordTimes) {
        /* Simulates waiting for the drum to rotate through the specified number
        of word-times, which must be non-negative. Increments the current drum
        location by that amount and advances the emulation clock accordingly */

        this.L.value = (this.L.value + wordTimes) % Util.longLineSize;
        this.eTime += wordTimes*Util.wordTime;
    }

    /**************************************/
    waitUntil(loc) {
        /* Simulates waiting for the drum to rotate to the specified word
        location. Locations must be non-negative. Updates the drum location
        and the emulation clock via waitFor() */
        let words = (loc - this.L.value + Util.longLineSize) % Util.longLineSize;

        if (words > 0) {
            this.waitFor(words);
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

        return (this.MQ[0].value >> 28) & 1;
    }

    /**************************************/
    getMQ1T29Bit() {
        /* Returns the value of the high-order (T29) bit of MQ:1 (odd word) */

        return (this.MQ[1].value >> 28) & 1;
    }

    /**************************************/
    getPN0T1Bit() {
        /* Returns the value of the sign bit of PN:0 (even word) */

        return this.PN[0] & 1;
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
        /* Returns the value of the high-order (T29) bit of MQ:0 (even word) */

        return (this.PN[0].value >> 28) & 1;
    }


    /*******************************************************************
    *  I/O Subsystem Drum Methods                                      *
    *******************************************************************/

    /**************************************/
    get ioL4() {
        /* Returns the current word-time for four-word lines */

        return this.ioL.value % Util.fastLineSize;
    }

    /**************************************/
    ioStartTiming() {
        /* Initializes the drum and emulation timing for I/O. Math.max()
        is used to compensate for many browsers limiting the precision of
        performance.now() to one millisecond, which can make real time appear
        to go backwards */

        this.ioTime = Math.max(performance.now(), this.ioTime);
        this.ioL.value = Math.round(this.ioTime/Util.wordTime) % Util.longLineSize;
    }

    /**************************************/
    ioThrottle() {
        /* Returns a promise that unconditionally resolves after a delay to
        allow browser real time to catch up with the I/O subsystem clock, this.ioTime.
        Since most browsers will force a setTimeout() to wait for a minimum of
        4ms, this routine will not delay if the difference between real time
        (as reported by performance.now()) and emulation time is less than
        Util.minTimeout */

        return this.ioTimer.delayUntil(this.ioTime);
    }

    /**************************************/
    ioWaitFor(wordTimes) {
        /* Simulates waiting for the drum to rotate through the specified number
        of word-times, which must be non-negative. Increments the current drum
        location by that amount and advances the emulation clock accordingly */

        this.ioL.value = (this.ioL.value + wordTimes) % Util.longLineSize;
        this.ioTime += wordTimes*Util.wordTime;
    }

    /**************************************/
    ioWaitUntil(loc) {
        /* Simulates waiting for the drum to rotate to the specified word
        location. Locations must be non-negative. Updates the drum location
        and the emulation clock via waitFor() */
        let words = (loc - this.ioL.value + Util.longLineSize) % Util.longLineSize;

        if (words > 0) {
            this.ioWaitFor(words);
        }
    }

    /**************************************/
    ioWaitUntil4(loc) {
        /* Simulates waiting for the drum to rotate to the specified word
        location on a 4-word line. Locations must be non-negative. Updates
        the drum location and the emulation clock via waitFor() */
        let words = (loc - this.ioL.value + Util.longLineSize) % Util.fastLineSize;

        if (words > 0) {
            this.ioWaitFor(words);
        }
    }

    /**************************************/
    ioRead19() {
        /* Reads a word transparently from drum line 19 at the current
        location, this.ioL */

        return this.line[19][this.ioL.value];
    }

    /**************************************/
    ioWrite19(word) {
        /* Writes a word transparently to drum line 19 at the current
        location */

        this.line[19][this.ioL.value] = word;
    }

    /**************************************/
    ioRead23() {
        /* Reads a word transparently from drum line 23 at the current
        location, this.ioL */

        return this.line[23][this.ioL4];
    }

    /**************************************/
    ioWrite23(word) {
        /* Writes a word transparently to drum line 23 at the current
        location */

        this.line[23][this.ioL4] = word;
    }

    /**************************************/
    ioReadMZ() {
        /* Reads a word transparently from the I/O buffer MZ at the current
        location, this.ioL */

        return this.MZ[this.ioL4];
    }

    /**************************************/
    ioWriteMZ(word) {
        /* Writes a word transparently to the I/O buffer MZ at the current
        location, this.ioL */

        this.MZ[this.ioL4] = word;
    }

    /**************************************/
    async ioPrecessARToCode(bits) {
        /* Precesses the original contents of AR (line 28) by "bits" bits,
        inserting zero in the four low-order bits of the word, and returning
        the original "bits" high order bits of the word and a Boolean that is
        always false (to make the return value signature identical to
        ioPrecess19ToCode). This is normally used to get the next data code
        for output */
        let keepBits = Util.wordBits - bits;
        let keepMask = Util.wordMask >> bits;
        let codeMask = Util.wordMask >> keepBits;

        let word = this.read(28) & Util.wordMask;
        let code = word >> keepBits;
        this.write(28, (word & keepMask) << bits);
        this.ioWaitFor(1);

        // await this.ioThrottle();
        return [code, false];
    }

    /**************************************/
    async ioPrecessMZTo19() {
        /* Precesses all of line MZ to line 19, leaving the original contents
        of MZ in words 0-3 of 19, precessing the original contents of line 19
        by four words to higher addresses in the line, and leaving the original
        contents of words 104-107 of line 19 in line MZ. Since this operation
        can run concurrently with other I/O-based drum operations, it doesn't
        use the regular ioReadX or ioWriteX routines nor update this.ioL */

        // Compute delay until line 19 word 0.
        let delay = ((Util.longLineSize - this.ioL) % Util.longLineSize)*Util.wordTime;

        for (let x=0; x<Util.longLineSize; ++x) {
            // Synchronize drum timing
            if (delay > Util.minTimeout) {
                await this.line19Timer.set(delay);
                delay = 0;
            }

            let mx = x % Util.fastLineSize;
            let wMZ = this.MZ[mx];
            //console.log("PrecessMZTo19: %3d %s %s", x,
            //    wMZ.toString(16).padStart(8, "0"),
            //    this.line[19][x].toString(16).padStart(8, "0"));

            this.MZ[mx] = this.line[19][x];
            this.line[19][x] = wMZ;
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

        return this.line[19][Util.fastLineSize-1] & 1;
    }

    /**************************************/
    async ioPrecessMZToCode(bits) {
        /* Precesses the original contents of MZ by "bits" bits to higher
        word numbers, inserting zero in the four low-order bits of word 0, and
        returning the original "bits" high order bits of word 3. This is
        normally used to get the next format code for output */
        let keepBits = Util.wordBits - bits;
        let keepMask = Util.wordMask >> bits;
        let codeMask = Util.wordMask >> keepBits;
        let code = 0;
        let word = 0;

        this.ioWaitUntil4(0);
        for (let x=0; x<Util.fastLineSize; ++x) {
            word = this.ioReadMZ() & Util.wordMask;
            this.ioWriteMZ(((word & keepMask) << bits) | code);
            code = word >> keepBits;
            this.ioWaitFor(1);
        }

        await this.ioThrottle();
        return code;
    }

    /**************************************/
    async ioPrecessLongLineToMZ(line) {
        /* Precesses the original contents of words 0-3 of the specified long
        line to MZ by three bits, inserting zero in the three low-order bits of
        MZ word 0, and returning the original three high order bits of word 3
        from the long line. This is normally used to load MZ from the long line
        and return the first format code for output */
        const bits = 3;
        let keepBits = Util.wordBits - bits;
        let keepMask = Util.wordMask >> bits;
        let codeMask = Util.wordMask >> keepBits;
        let code = 0;
        let word = 0;

        this.ioWaitUntil(0);
        for (let x=0; x<Util.fastLineSize; ++x) {
            word = this.line[line][x] & Util.wordMask;
            this.ioWriteMZ(((word & keepMask) << bits) | code);
            code = word >> keepBits;
            this.ioWaitFor(1);
        }

        await this.ioThrottle();
        return code;
    }

    /**************************************/
    async ioCopy23ToMZ() {
        /* Copies the four words of line 23 to MZ, freeing 23 for more input */

        this.ioWaitUntil4(0);
        for (let x=0; x<Util.fastLineSize; ++x) {
            this.ioWriteMZ(this.ioRead23());
            this.ioWaitFor(1);
        }

        await this.ioThrottle();
    }

    /**************************************/
    async ioPrecess19ToCode(bits) {
        /* Precesses the original contents of line 19 by "bits" bits to higher
        word numbers, inserting zero in the four low-order bits of word 0, and
        returning the original "bits" high order bits of word 107 and a Boolean
        indicating whether line 19 is now "empty" (all zeroes). This is
        normally used to get the next data code for output. The sign bit in word
        107 is sampled before precession of that word takes place, and the state
        of that bit is also returned */
        let keepBits = Util.wordBits - bits;
        let keepMask = Util.wordMask >> bits;
        let codeMask = Util.wordMask >> keepBits;
        let code = 0;
        let empty = true;
        let word = 0;

        this.ioWaitUntil(0);
        for (let x=0; x<Util.longLineSize; ++x) {
            word = this.ioRead19() & Util.wordMask;
            if (word) {
                empty = false;
            }

            this.ioWrite19(((word & keepMask) << bits) | code);
            code = word >> keepBits;
            this.ioWaitFor(1);
            if (x % 16 == 0) {          // 4.30ms
                await this.ioThrottle();
            }
        }

        await this.ioThrottle();
        return [code, empty];
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

        this.ioWaitUntil4(0);
        for (let x=0; x<Util.fastLineSize; ++x) {
            word = this.ioRead23() & Util.wordMask;
            this.ioWrite23(((word & keepMask) << bits) | carry);
            carry = word >> keepBits;
            this.ioWaitFor(1);
        }
        await this.ioThrottle();
        return carry;
    }

} // class Drum


// Static class properties

Drum.minDelayTime = 4;                  // minimum time to accumulate throttling delay, >= 4ms
