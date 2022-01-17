/***********************************************************************
* retro-g15/emulator Drum.js
************************************************************************
* Copyright (c) 2021, Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* JavaScript class module for the G-15 drum and system timing.
************************************************************************
* 2021-12-08  P.Kimpel
*   Original version.
***********************************************************************/

export {Drum}

import {Register} from "./Register.js";


class Drum {

    constructor() {
        /* Constructor for the G-15 drum object, including the drum-based registers */
        let drumOffset = 0;
        let size = 0;

        let buildRegisterArray = (length, bits, invisible) => {
            let a = [];                 // the register array

            for (let x=0; x<length; ++x) {
                a.push(new Register(bits, this, invisible));
            }

            return a;
        };

        this.eTime = 0;                 // current emulation time, ms
        this.eTimeSliceEnd = 0;         // current timeslice end emulation time, ms

        // Current drum rotational position: word-time
        this.L = new Register(7, this, false);

        // Drum storage and line layout
        this.drum = new ArrayBuffer(2288*Drum.wordBytes); // Drum: 32-bit Uint words
        this.line = new Array(29);

        // Build the long lines, 108 words each
        size = Drum.longLineSize*Drum.wordBytes;
        for (let x=0; x<20; ++x) {
            this.line[x] = new Uint32Array(this.drum, drumOffset, Drum.longLineSize);
            drumOffset += size;
        }

        // Build the fast lines, 4 words each
        size = Drum.fastLineSize*Drum.wordBytes;
        for (let x=20; x<24; ++x) {
            this.line[x] = new Uint32Array(this.drum, drumOffset, Drum.fastLineSize);
            drumOffset += size;
        }

        // Build the four-word MZ I/O buffer line
        size = 4*Drum.wordBytes;
        this.MZ = new Uint32Array(this.drum, drumOffset, 4);
        drumOffset += size;

        // Build the 108-word Number Track
        size = Drum.longLineSize*Drum.wordBytes;
        this.CN = new Uint32Array(this.drum, drumOffset, Drum.longLineSize);
        drumOffset += size;

        // Build the double-precision registers (not implemented as part of the drum array
        this.MQ = this.line[24] = buildRegisterArray(2, Drum.wordBits, true);   // was: new Uint32Array(this.drum, drumOffset, 2);
        this.ID = this.line[25] = buildRegisterArray(2, Drum.wordBits, true);   // was: new Uint32Array(this.drum, drumOffset, 2);
        this.PN = this.line[26] = buildRegisterArray(2, Drum.wordBits, true);   // was: new Uint32Array(this.drum, drumOffset, 2);
        this.line[27] = null;           // TEST register, not actually on the drum

        // Build the one-word registers (not implemented here as part of the drum array)
        this.AR = this.line[28] = new Register(Drum.wordBits, this. true);
        this.CM = new Register(Drum.wordBits, this, true);
    }

    /**************************************/
    get L2() {
        /* Returns the current word-time for two-word registers */

        return this.L.value % 2;
    }

    /**************************************/
    get L4() {
        /* Returns the current word-time for four-word lines */

        return this.L.value % Drum.fastLineSize;
    }

    /**************************************/
    startTiming() {
        /* Initializes the drum and emulation timing */

        this.eTime = performance.now();
        this.eTimeSliceEnd = this.eTime + Drum.eSliceTime;
        this.L.value = Math.round(performance.now/Drum.wordTime) % Drum.longLineSize;
    }

    /**************************************/
    throttle() {
        /* Returns a promise that unconditionally resolves after a delay to
        allow browser real time to catch up with the emulation clock, this.eTime.
        Since most browsers will force a setTimeout() to wait for a minimum of
        4ms, this routine will not delay if the difference between real time
        (as reported by performance.now()) and emulation time is less than
        Drum.eSliceTime */
        let delay = this.eTime - performance.now();

        if (delay < Drum.eSliceTime) {
            return Promise.resolve(null);       // i.e., don't wait at all
        } else {
            this.eTimeSliceEnd = this.eTime + Drum.eSliceTime;
            return new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    /**************************************/
    waitFor(wordTimes) {
        /* Simulates waiting for the drum to rotate through the specified number
        of word-times, which must be non-negative. Increments the current drum
        location by that amount and advances the emulation clock accordingly */

        this.L.value = (this.L.value + wordTimes) % Drum.longLineSize;
        this.eTime += Drum.wordTime*wordTimes;
    }

    /**************************************/
    waitUntil(loc) {
        /* Simulates waiting for the drum to rotate to the specified word
        location. Locations must be non-negative. Updates the drum location
        and the emulation clock via waitFor() */
        let delay = loc - this.L.value;

        if (delay < 0) {                // wrap-around
            delay += Drum.longLineSize;
        }

        waitFor(delay);
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
    setPNSign(sign) {
        /* Sets the sign bit in the even word of PN. This is used after an
        addition or subtraction to PN to set the final sign of the operation.
        It's a bit of a kludge, but the way PN works is a bit of a kludge,
        anyway. Unlike the other drum read/write routines, it ignores L and
        operates on this.PN[0] unconditionally */

        this.PN[0].setBit(0, sign);
    }

} // class Drum


// Static class properties

Drum.wordBits = 29;                     // bits per G-15 word
Drum.wordBytes = 4;                     // bytes per G-15 word (32 bits holding 29 bits)
Drum.longLineSize = 108;                // words per long drum line
Drum.fastLineSize = 4;                  // words per fast drum line

Drum.wordTime = 60000/1800/124;         // one word time on the drum, ms
Drum.bitTime = Drum.wordTime/29;        // one bit time on the drum, ms
Drum.eSliceTime = 6;                    // minimum time to accumulate throttling delay, > 4ms
