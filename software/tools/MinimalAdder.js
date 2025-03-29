/***********************************************************************
* retro-g15/software/tools MinimalAdder.js
************************************************************************
* Copyright (c) 2025, Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* JavaScript class module to illustrate simplified operation of the G-15
* single-precision adder.
*
************************************************************************
* 2023-03-26  P.Kimpel
*   Original version, from retro-g15/Processor.js v1.06.
***********************************************************************/

export {MinimalAdder}

class MinimalAdder {

    static wordBits = 29;                       // bits per word
    static wordMagBits = 28;                    // magnitude bits in a G-15 word
    static wordMask = 0x1FFFFFFF;               // 29 bits
    static absWordMask = 0x1FFFFFFE;            // all but the sign bit
    static wordSignMask = 0x01;                 // sign bit mask
    static two28 = 0x10000000;                  // 2**28 for complementing word magnitude values

    // Characteristic values.
    static chTR = 0;                            // transfer unchanged
    static chAD = 1;                            // transfer with complement (for add)
    static chAV = 2;                            // transfer as absolute value
    static chSU = 3;                            // transfer negated with complement (for subtract)

    // Instance variables.
    ar = 0;                                     // single-precision accumulator
    suppressMinus0 = false;                     // true if operand is -0
    overflowed = false;                         // true if overflow occurred

    get AR() {                                  // retrieve AR value
        return this.ar;
    }

    /**************************************/
    addSingle(a, b, suppressMinus0=false) {
        /* Adds two signed, single-precision words. Assumes negative numbers
        have been converted to complement form. Sets this.overflowed true
        if the signs of the operands are the same and the sign of the sum
        does not match). Returns the sum in G-15 complement form */
        let aSign = a & MinimalAdder.wordSignMask;      // sign of a
        let aMag =  a & MinimalAdder.absWordMask;       // 2s complement magnitude of a
        let bSign = b & MinimalAdder.wordSignMask;      // sign of b
        let bMag =  b & MinimalAdder.absWordMask;       // 2s complement magniturde of b

        // Develop the raw 2s-complement sum without the sign bits.
        let sum = aMag + bMag;
        let endCarry = suppressMinus0 ? 1 : (sum >> MinimalAdder.wordBits) & 1;
        sum &= MinimalAdder.wordMask;           // discard any overflow bits in sum

        // Check for arithmetic overflow (see drawing 27 in Theory of Operation).
        this.overflowed = aSign == bSign && (endCarry ? (bSign == 0 || sum == 0) : (bSign != 0));

        // Put the raw sum back into G-15 complement format.
        let sumSign = aSign ^ bSign ^ endCarry;
        return sum | sumSign;
    }

    /**************************************/
    complementSingle(word) {
        /* Converts a single-precision word or the even word of a double-
        precision pair between complement and non-complement form */
        let sign = word & MinimalAdder.wordSignMask;
        let mag = word >> 1;

        this.suppressMinus0 = (sign == 1 && mag == 0);
        if (sign) {
            mag = MinimalAdder.two28 - mag;     // convert to 2-s complement if negative
        }

        return ((mag << 1) & MinimalAdder.wordMask) | sign;
    }

    /**************************************/
    transferToAR(word, char) {
        /* Executes a transfer from any source to the AR register (D=28). Note
        that for D=28, "via AR" operations are not supported, and instead
        characteristics 2 & 3 perform absolute value and negation, respectively */

        switch (char) {
        case MinimalAdder.chTR:         // TR
            this.ar = word;
            break;

        case MinimalAdder.chAD:         // AD
            this.ar = this.complementSingle(word);
            if (this.suppressMinus0) {
                this.ar = 0;                                    // suppress -0
            }
            break;

        case MinimalAdder.chAV:         // AV
            this.ar = word & MinimalAdder.absWordMask;
            break;

        case MinimalAdder.chSU:         // SU
            this.ar = this.complementSingle(word ^ 1);          // change sign bit
            if (this.suppressMinus0) {
                this.ar = 0;                                    // suppress -0
            }
            break;
        }
    }

    /**************************************/
    addToAR(word, char) {
        /* Executes an addition from any source to the AR+ register (D=29).
        AR is assumed to be in complement form. Sets OVERFLOW if necessary */
        let ib = 0;                 // intermediate bus: effective addend

        switch (char) {
        case MinimalAdder.chTR:         // TR
            ib = word;
            this.ar = this.addSingle(this.ar, ib);
            break;

        case MinimalAdder.chAD:         // AD
            ib = this.complementSingle(word);
            this.ar = this.addSingle(this.ar, ib, this.suppressMinus0);
            break;

        case MinimalAdder.chAV:         // AV
            ib = word & MinimalAdder.absWordMask;
            this.ar = this.addSingle(this.ar, ib);
            break;

        case MinimalAdder.chSU:         // SU
            ib = this.complementSingle(word ^ 1);               // change sign bit
            this.ar = this.addSingle(this.ar, ib, this.suppressMinus0);
            break;
        }
    }
}
