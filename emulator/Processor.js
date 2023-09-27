/***********************************************************************
* retro-g15/emulator Processor.js
************************************************************************
* Copyright (c) 2021, Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* JavaScript class module for the G-15 processor.
*
* Register, flip-flop, and signal names are taken mostly from the G-15
* "Theory of Operation" manual:
*   http://bitsavers.org/pdf/bendix/g-15/60121600_G15_Theory_Of_Operation_Nov64.pdf
*
************************************************************************
* 2021-12-10  P.Kimpel
*   Original version.
***********************************************************************/

export {Processor}

import * as Util from "./Util.js";
import * as IOCodes from "./IOCodes.js";

import {Drum} from "./Drum.js";
import {FlipFlop} from "./FlipFlop.js";
import {Register} from "./Register.js";

const regMQ = 24;                          // MQ register drum line
const regID = 25;                          // ID register drum line
const regPN = 26;                          // PN register drum line
const regAR = 28;                          // AR register drum line


class Processor {

    constructor(context) {
        /* Constructor for the G-15 processor object. The "context" object
        supplies UI and I/O objects from the G-15 emulator global environment */

        this.drum = new Drum();                         // the drum memory
        this.context = context;

        // Flip-flops
        this.AS = new FlipFlop(this.drum, false);       // Automatic/Standard I/O reload FF (AN models only)
        this.BP = new FlipFlop(this.drum, false);       // breakpoint bit in command
        this.C1 = new FlipFlop(this.drum, false);       // single/double bit in command
        this.CG = new FlipFlop(this.drum, false);       // next command from AR FF
        this.CH = new FlipFlop(this.drum, false);       // HALT FF
        this.CJ = new FlipFlop(this.drum, true);        // initiate read command-state (CH/ . CZ)
        this.CQ = new FlipFlop(this.drum, false);       // TEST false FF (=> N = N+1)
        this.CS = new FlipFlop(this.drum, false);       // "via AR" characteristic FF
        this.CZ = new FlipFlop(this.drum, true);        // read-command-state enabled (used here to control stepping)
        this.DI = new FlipFlop(this.drum, false);       // immediate/deferred execution bit in command
        this.FO = new FlipFlop(this.drum, false);       // overflow FF
        this.IP = new FlipFlop(this.drum, false);       // sign FF for 2-word registers
        this.OS = new FlipFlop(this.drum, true);        // I/O sign bit buffer
        this.RC = new FlipFlop(this.drum, false);       // read-command state FF
        this.SA = new FlipFlop(this.drum, false);       // typewriter enable (safety) switch FF
        this.TR = new FlipFlop(this.drum, false);       // transfer-state FF
        this.VV = new FlipFlop(this.drum, false);       // standard-command violation FF

        // Registers (additional registers are part of the Drum object)
        this.C = new Register( 2, this.drum, false);    // characteristic bits in command
        this.CD = new Register( 3, this.drum, false);   // current command-line designator
        this.D  = new Register( 5, this.drum, false);   // destination line in command
        this.IR = new Register(Util.wordBits, this.drum, true);
                                                        // input register (zero unless external circuit exists)
        this.N  = new Register( 7, this.drum, false);   // next cmd location in command
        this.OC = new Register( 5, this.drum, false);   // I/O operation code register (bit 5 = READY)
        this.OR = new Register(Util.wordBits, this.drum, true);
                                                        // output register (a sink unless external circuit exists)
        this.S  = new Register( 5, this.drum, false);   // source line in command
        this.T  = new Register( 7, this.drum, false);   // timing number from command
        this.cmdLoc = new Register(7, this.drum, false);// current command word-time

        // General emulator state
        this.cmdLine = 0;                               // current actual command line (see CDXlate)
        this.deferredBP = false;                        // breakpoint deferred due to return exit cmd
        this.overflowed = false;                        // true if last addition overflowed (DEBUG)
        this.poweredOn = false;                         // powered up and ready to run
        this.tracing = false;                           // trace command debugging

        // Single- and double-precision inter-word globals
        this.dpCarry = 0;                               // inter-word carry bit for double-precision
        this.dpEvenSign = 0;                            // sign of the even word of a double-precision pair
        this.mqShiftCarry = 0;                          // left-precession carry bit for MQ
        this.pnAddCarry = 0;                            // addition inter-word carry bit for PN
        this.pnAddendSign = 0;                          // sign of double-precision addend
        this.pnAugendSign = 0;                          // sign of double-precision augend (PN)
        this.pnEvenAddendMag = 0;                       // magnitude of DP even addend word
        this.pnEvenSumZero = false;                     // true if PN even-word addition == 0
        this.pnSign = 0;                                // sign bit from PN even word

        // UI state
        this.bellTiming = 0;                            // word-times the bell should be rung (sensed by ControlPanel)
        this.computeSwitch = 0;                         // 0=OFF, 1=GO, 2=BP
        this.enableSwitch = 0;                          // 0=normal, 1=enable typewriter keyboard
        this.punchSwitch = 0;                           // 0=off, 1=copy to paper-tape punch
        this.violationHaltSwitch = 0;                   // halt on standard-command violation

        // I/O Subsystem
        this.activeIODevice = null;                     // current I/O device object
        this.duplicateIO = false;                       // second I/O of same type initiated while first in progress
        this.ioBitCount = 0;                            // current input/output bit count
        this.ioTimer = new Util.Timer();                // general timer for I/O operations
        this.ioPromise = Promise.resolve();             // general Promise for I/O operations

        // Bound methods
        this.boundTransformNormal = this.transformNormal.bind(this);
        this.boundIOPrecess19ToCode = this.drum.ioPrecess19ToCode.bind(this.drum);
        this.boundIOPrecessARToCode = this.drum.ioPrecessARToCode.bind(this.drum);
    }


    /*******************************************************************
    *  Utility Methods                                                 *
    *******************************************************************/

    /**************************************/
    lineL(line, loc) {
        /* Computes the line-relative location. Used for debugging only */

        if (line < 20) {
            return loc;
        } else if (line < 24) {
            return loc%4;
        } else if (line < 27) {
            return loc%2;
        } else {
            return loc;
        }
    }

    /**************************************/
    traceRegisters() {
        /* Formats the registers to console.log */
        let loc = this.drum.L.value;

        console.log("              REG L=%3d(%d): AR=%s, IP=%d, ID=%s %s, MQ=%s %s, PN=%s %s PN%s FO=%d%s",
                loc, loc%2,
                Util.g15SignedHex(this.drum.AR.value).padStart(8, " "),
                this.IP.value,
                Util.g15Hex(this.drum.ID[1].value).padStart(8, " "),
                Util.g15SignedHex(this.drum.ID[0].value).padStart(8, " "),
                Util.g15Hex(this.drum.MQ[1].value).padStart(8, " "),
                Util.g15SignedHex(this.drum.MQ[0].value).padStart(8, " "),
                Util.g15Hex(this.drum.PN[1].value).padStart(8, " "),
                Util.g15SignedHex(this.drum.PN[0].value).padStart(8, " "),
                (this.pnSign ? "-" : "+"),
                this.FO.value, (this.overflowed ? "*" : " "));
    }

    /**************************************/
    traceState() {
        // Log current processor state to the console

        console.log("<TRACE%3d>  @%2d:%3d L=%3d %s T=%3d BP=%d N=%3d C=%d S=%2d D=%2d %s",
                this.devices.paperTapeReader.blockNr,
                this.cmdLine, this.cmdLoc.value, this.drum.L.value, (this.DI.value ? "DEF" : "IMM"),
                this.T.value, this.BP.value, this.N.value, this.C.value, this.S.value, this.D.value,
                (this.C1.value ? "DP" : ""));
    }

    /**************************************/
    violation(msg) {
        /* Posts a violation of standard-command usage */

        this.VV.value = 1;
        console.warn("<VIOLATION> @%2d:%3d L=%3d %s T=%3d BP=%d N=%3d C=%d S=%2d D=%2d %s : %s",
                this.cmdLine, this.cmdLoc.value, this.drum.L.value, (this.DI.value ? "DEF" : "IMM"),
                this.T.value, this.BP.value, this.N.value, this.C.value, this.S.value, this.D.value,
                (this.C1.value ? "DP" : ""), msg);
        if (this.violationHaltSwitch) {
            this.stop();
        }
    }

    /**************************************/
    updateLampGlow(beta) {
        /* Updates the lamp glow for all registers and flip-flops in the
        system. Beta is a bias in the range (0,1). For normal update use 0;
        to freeze the current state in the lamps use 1 */
        let gamma = (this.CH.value ? 1 : beta || 0);

        // Processor Flip-flops
        this.AS.updateLampGlow(gamma);
        this.BP.updateLampGlow(gamma);
        this.C1.updateLampGlow(gamma);
        this.CG.updateLampGlow(gamma);
        this.CH.updateLampGlow(gamma);
        this.CJ.updateLampGlow(gamma);
        this.CQ.updateLampGlow(gamma);
        this.CS.updateLampGlow(gamma);
        this.CZ.updateLampGlow(gamma);
        this.DI.updateLampGlow(gamma);
        this.FO.updateLampGlow(gamma);
        this.IP.updateLampGlow(gamma);
        this.RC.updateLampGlow(gamma);
        this.SA.updateLampGlow(gamma);
        this.TR.updateLampGlow(gamma);

        // Processor Registers
        this.C.updateLampGlow(gamma);
        this.CD.updateLampGlow(gamma);
        this.D .updateLampGlow(gamma);
        this.IR.updateLampGlow(gamma);
        this.N .updateLampGlow(gamma);
        this.OC.updateLampGlow(gamma);
        this.OR.updateLampGlow(gamma);
        this.S .updateLampGlow(gamma);
        this.T .updateLampGlow(gamma);

        // General emulator state
        this.VV.updateLampGlow(gamma);
        this.cmdLoc.updateLampGlow(gamma);

        // Drum Registers
        this.drum.L.updateLampGlow(gamma);
        this.drum.MQ[0].updateLampGlow(gamma);
        this.drum.MQ[1].updateLampGlow(gamma);
        this.drum.ID[0].updateLampGlow(gamma);
        this.drum.ID[1].updateLampGlow(gamma);
        this.drum.PN[0].updateLampGlow(gamma);
        this.drum.PN[1].updateLampGlow(gamma);
        this.drum.AR.updateLampGlow(gamma);
        this.drum.CM.updateLampGlow(gamma);
    }


    /*******************************************************************
    *  Transfer State                                                  *
    *******************************************************************/

    /**************************************/
    addSingle(a, b) {
        /* Adds two signed, single-precision words. Assumes negative numbers
        have been converted to complement form. Sets the overflow indicator
        if the signs of the operands are the same and the sign of the sum
        does not match). Returns the sum in G-15 complement form. Avoids
        returning -0 */
        let aSign = a & Util.wordSignMask;      // sign of a
        let aMag = a >> 1;                      // 2s complement magnitude of a
        let bSign = b & Util.wordSignMask;      // sign of b
        let bMag = b >> 1;                      // 2s complement magniturde of b

        // This is a little messy -- in G-15 arithmetic, adding a -0 would
        // interfere with determination of the result sign, so the G-15 had
        // a rather complicated test to detect -0 coming off the inverting
        // gates at T29 time and cause the adder to adjust the sign in the
        // next word time. The following has the equivalent effect. See the
        // Theory of Operations manual, page 34, paragraph C-10t.

        // Do not allow -0 to reach the adder.
        if (aSign && aMag == 0) {
            aSign = 0;
        }
        if (bSign && bMag == 0) {
            bSign = 0;
        }

        // Put the signs in their 2s-complement place and develop the raw sum.
        let sum = (aMag | (aSign << Util.wordMagBits)) + (bMag | (bSign << Util.wordMagBits));
        let sumSign = (sum >> Util.wordMagBits) & 1;

        // Put the raw sum back into G-15 complement format and inhibit -0.
        sum = (sum << 1) & Util.wordMask;
        if (sum == 0) {
            sumSign = 0;                // inhibit -0
        }

        // Check for overflow.
        this.overflowed = aSign == bSign && aSign != sumSign;

        return sum | sumSign;
    }

    /**************************************/
    addDoubleEven(a, b) {
        /* Adds the even word "b" (representing the source word) of a double-
        precison pair to the even word of "a" (representing PN-even).
        Assumes negative numbers have been converted to complement form.
        Sets this.pnAddCarry from the 30th bit of the raw sum, but does not set
        the overflow indicator. Returns the even-word partial sum */

        this.pnAugendSign = a & Util.wordSignMask;      // sign of DP augend (PN)
        this.pnAddendSign = b & Util.wordSignMask;      // sign of DP addend
        this.pnEvenAddendMag = b & Util.absWordMask;    // magnitude of even addend word

        // Zero the original signs in the words and develop the even-word sum and carry.
        let sum = (a & Util.absWordMask) + (b & Util.absWordMask);
        this.pnAddCarry = (sum >> Util.wordBits) & 1;   // extract the carry into the odd word

        // Return the even-word sum (sign bit will be 0).
        sum &= Util.wordMask;
        this.pnEvenSumZero = (sum == 0);

        return sum;
    }

    /**************************************/
    addDoubleOdd(a, b) {
        /* Adds the odd word "b" (representing the source word) of a double-
        precision pair to the odd word "a" (representing PN-odd). Assumes
        negative numbers have been converted to complement form. Sets the
        overflow indicator if the signs of the operands were the same and
        the sign of the sum does not match. Computes the result sign and
        returns the odd-word sum (which does not have a sign bit) with the
        result sign in this.pnSign. Avoids generating a -0 result */

        // This is a little messy -- in G-15 arithmetic, adding a -0 would
        // interfere with determination of the result sign, so the G-15 had
        // a rather complicated test to detect -0 coming off the inverting
        // gates at T29 time and cause the adder to adjust the sign in the
        // next word time. The following has the equivalent effect. See the
        // Theory of Operations manual, page 34, paragraph C-10t.
        if (b == 0 && this.pnEvenAddendMag == 0 && this.pnAddendSign) {
            this.pnAddendSign = 0;      // do not allow -0 to reach the adder
        }

        // Put the signs in their 2s-complement places and develop the raw odd-word sum.
        let sum = (a | (this.pnAugendSign << Util.wordBits)) +
                  (b | (this.pnAddendSign << Util.wordBits)) + this.pnAddCarry;
        this.pnSign = (sum >> Util.wordBits) & 1;       // extract the 2s-complement sign

        // Put the raw sum back into G-15 complement format and inhibit -0.
        sum &= Util.wordMask;
        if (sum == 0 && this.pnEvenSumZero) {
            this.pnSign = 0;            // inhibit -0
        }

        // Check for overflow.
        this.overflowed = this.pnAugendSign == this.pnAddendSign && this.pnAugendSign != this.pnSign;

        // Return the odd-word sum with the result sign in this.pnSign.
        return sum;
    }

    /**************************************/
    complementSingle(word) {
        /* Converts a single-precision word or the even word of a double-
        precision pair between complement and non-complement form. The only
        case when a carry can propagate to the high-order word of a double-
        precision pair is when the low-order word is zero, so that is the
        only case when this.dpCarry is set to 1 */
        let sign = word & Util.wordSignMask;
        let mag = word >> 1;

        this.dpEvenSign = (this.drum.CE ? sign : 0);    // set to 0 on odd words
        if (sign) {
            mag = Util.two28 - mag;     // convert to 2-s complement if negative
        }

        this.dpCarry = mag >> Util.wordMagBits; // only used if this is the even word of a DP operation
        return ((mag << 1) & Util.wordMask) | sign;
    }

    /**************************************/
    complementDoubleOdd(word) {
        /* Converts the second word of a double-precision operand between
        complement forms, returning the converted word. this.dpCarry is assumed
        to hold any carry from complementing the even word of the pair.
        this.dpEvenSign is assumed to hold the sign from the even word of the
        pair. Any overflow from complementing the high-order word is discarded */

        if (this.dpEvenSign) {          // even word was negative
            return (Util.wordMask - word + this.dpCarry) & Util.wordMask;
        } else {
            return (word + this.dpCarry) & Util.wordMask;
        }
    }

    /**************************************/
    shiftIDRightEven() {
        /* Shifts the even word of ID right by one bit, discarding the former
        low-order bit, forcing the new sign bit to zero, and inserting the low-
        order bit from the odd word into the vacated high-order bit. Returns
        the value of ID:0 AFTER the shift. Assumes this.drum.L is even */
        let word = ((this.drum.read(regID) >> 1) & Util.absWordMask) |
                (this.drum.getID1T1Bit() << (Util.wordBits-1));

        this.drum.write(regID, word);
        return word;
    }

    /**************************************/
    shiftIDRightOdd() {
        /* Shifts the odd word of ID right by one bit and inserts zero into
        the vacated high-order bit. Returns the value of ID:1 AFTER the shift.
        Assumes this.drum.L is odd */
        let word = (this.drum.read(regID) >> 1) & Util.wordMask;

        this.drum.write(regID, word);
        return word;
    }

    /**************************************/
    shiftMQLeftEven() {
        /* Copies the high-order bit into this.mqShiftCarry for inserting into
        the odd word during the next word time, then shifts the even word of MQ
        left by one bit, discarding the former high-order bit, inserting a zero
        in the new sign bit. Assumes this.drum.L is even */
        let word = this.drum.read(regMQ);

        this.drum.write(regMQ, (word << 1) & Util.wordMask);
        this.mqShiftCarry = (word >> (Util.wordBits-1)) & 1;
    }

    /**************************************/
    shiftMQLeftOdd() {
        /* Shifts the odd word of MQ left by one bit, inserting this.mqShiftCarry
        into the vacated low-order bit, and discarding the former high-order
        bit. Assumes this.drum.L is odd. Note that before the first call on
        this routine within an operation, this.mqShiftCarry must be initialized
        to the high-order bit of MQ:0, which if the operation begins on an even
        word will be done by shiftMQLeftEven, but if it begins on an odd word,
        should be done by this.drum.getMQ0T29Bit() */
        let word = this.drum.read(regMQ);

        this.drum.write(regMQ, ((word << 1) & Util.wordMask) | this.mqShiftCarry);
        this.mqShiftCarry = (word >> (Util.wordBits-1)) & 1;
    }

    /**************************************/
    setCommandLine(cmd) {
        /* Sets this.CD and this.cmdLine to specify the drum line for command
        execution */

        cmd &= 0x07;                    // only the low-order three bits
        this.CD.value = cmd;
        this.cmdLine = Processor.CDXlate[cmd];
    }

    /**************************************/
    waitUntilT() {
        /* Advances the drum to the end of Transfer State: if immediate, T.
        If deferred, T+1+DP */

        this.drum.waitUntil(this.DI.value ? this.T.value+1+this.C1.value : this.T.value);
    }

    /**************************************/
    readSource() {
        /* Reads one word from the source specified by this.S at the current
        drum location, returning the raw word value */

        switch (this.S.value) {
        case  0:        // 108-word drum lines
        case  1:
        case  2:
        case  3:
        case  4:
        case  5:
        case  6:
        case  7:
        case  8:
        case  9:
        case 10:
        case 11:
        case 12:
        case 13:
        case 14:
        case 15:
        case 16:
        case 17:
        case 18:
        case 19:
        case 20:        // 4-word drum lines
        case 21:
        case 22:
        case 23:
            return this.drum.read(this.S.value);
            break;
        case 24:        // MQ
        case 25:        // ID
        case 26:        // PN
            {   let word = this.drum.read(this.S.value);
                // IP is applied as sign only for TR and TVA
                if (this.C.value == 0 || (this.C.value == 2 && this.CS.value)) {
                    if (!this.C1.value || this.drum.CE) {       // sign time: not DP or at even word
                        word = (word & Util.absWordMask) | this.IP.value;
                    }
                }
                return word;
            }
            break;
        case 27:        // 20.21 + 20/.AR
            {   let m20 = this.drum.read(20);
                let m21 = this.drum.read(21);
                return (m20 & m21) | (~m20 & this.drum.read(regAR));
            }
            break;
        case 28:        // AR
            return this.drum.read(regAR);
            break;
        case 29:        // 20.(INPUT REGISTER)
            return this.drum.read(20) & this.IR.value;
            break;
        case 30:        // 20/.21
            return (~this.drum.read(20)) & this.drum.read(21);
            break;
        case 31:        // 20.21
            return this.drum.read(20) & this.drum.read(21);
            break;
        }
    }

    /**************************************/
    transferDriver(transform) {
        /* Executes a transfer to a destination under control of the transform
        function, which is called each word-time during execution. This routine
        handles the majority of immediate/deferred and DP timing details */
        let count = 1;                  // defaults to one word time

        if (this.DI.value) {
            // Deferred execution: transfer one or two words at time T.
            this.drum.waitUntil(this.T.value);
            if (this.C1.value && this.drum.CE) {
                ++count;                // DP operand: two-word transfer state
            }
        } else {
            // Immediate execution: transfer during current word time through T-1.
            count = this.T.value - this.drum.L.value;
            if (count <= 0) {
                count += Util.longLineSize;
            }
        }

        if (this.C1.value && !this.drum.CE) {
            this.violation("DP transfer starting on ODD word");
        }

        do {
            transform();
            this.drum.waitFor(1);
        } while (--count > 0);
    }

    /**************************************/
    transformNormal() {
        /* Implements the source-to-destination transformation for normal
        transfers (D=0..23). "Via AR" operations are not supported for the
        sources >=28, so special action is taken for those cases */
        let a = 0;                      // value written to AR (for TVA/AVA)
        let b = 0;                      // word written to D line (orig AR for TVA/AVA)
        let word = this.readSource();   // original source word

        switch (this.C.value) {
        case 0: // TR (transfer)
            b = word;
            break;
        case 1: // AD ("add": complement negative numbers)
            if (!this.C1.value || this.drum.CE) {               // SP operation or even word
                b = this.complementSingle(word);
            } else {                                            // DP odd word
                b = this.complementDoubleOdd(word);
            }
            break;
        case 2: // TVA (transfer via regAR) or AV (absolute value)
            if (this.CS.value) {        // transfer via AR
                b = this.drum.read(regAR);
                this.drum.write(regAR, a = word);
            } else {                    // absolute value
                if (!this.C1.value || this.drum.CE) {           // SP operation or even word
                    b = word & Util.absWordMask;
                } else {                                        // DP odd word
                    b = word;
                }
            }
            break;
        case 3: // AVA ("add" via AR) or SU ("subtract": change sign)
            if (this.CS.value) {        // "add" via AR
                b = this.drum.read(regAR);
                if (!this.C1.value || this.drum.CE) {           // SP operation or even word
                    this.drum.write(regAR, a = this.complementSingle(word));
                } else {                // DP odd word
                    this.drum.write(regAR, a = this.complementDoubleOdd(word));
                }
            } else {                    // "subtract": reverse sign and complement if now negative
                if (!this.C1.value || this.drum.CE) {           // SP operation or even word
                    b = this.complementSingle(word ^ 1);
                } else {                // DP odd word
                    b = this.complementDoubleOdd(word);
                }
            }
            break;
        } // switch this.C

        this.drum.write(this.D.value, b)
        if (this.tracing) {
            let loc = this.drum.L.value;
            if (this.CS.value) {
                console.log("              VA: AR=%s > %2d:%3d, %2d:%3s=%s %d> AR=%s",
                        Util.g15SignedHex(b).padStart(8, " "),
                        this.D.value, this.lineL(this.D.value, loc),
                        this.S.value, this.lineL(this.S.value, loc),
                        Util.g15SignedHex(word).padStart(8, " "), this.C.value,
                        Util.g15SignedHex(a).padStart(8, " "));
            } else {
                console.log("              TR: %2d:%3d=%s %d> %2d:%3d=%s",
                        this.S.value, this.lineL(this.S.value, loc),
                        Util.g15SignedHex(word).padStart(8, " "), this.C.value,
                        this.D.value, this.lineL(this.D.value, loc),
                        Util.g15SignedHex(b).padStart(8, " "));
            }
        }
    }

    /**************************************/
    transferNormal() {
        /* Executes a transfer from any source to drum lines 0-23 */

        this.transferDriver(this.boundTransformNormal);
    }

    /**************************************/
    transferToTEST() {
        /* Executes a transfer from any source to the TEST register (D=27). If
        any single- or double-precision value is non-zero, CQ is set to cause
        the next command to be taken from N+1. Note that since the test is for
        non-zero, negative values do not need to be complemented before the test.
        The Theory of Operation Manual (p.48) says that if any one-bits appear
        on the LATE bus, CQ will be set. Therefore, -0 (which the adder does
        not generate) tests as non-zero */

        this.transferDriver(() => {
            let word = this.readSource();

            switch (this.C.value) {
            case 0: // TR (transfer)
                switch (this.S.value) {
                case 24:    // MQ
                case 25:    // ID
                case 26:    // PN
                    if (!this.C1.value || this.drum.CE) {
                        word &= Util.absWordMask;       // zero sign bit on even word for DP
                    }
                    break;
                }
                if (word) {
                    this.CQ.value = 1;
                }
                break;
            case 1: // AD ("add": complement negative numbers)
                if (word) {
                    this.CQ.value = 1;
                }
                break;
            case 2: // TVA (transfer via AR) or AV (absolute value)
                if (this.CS.value) {
                    if (this.S.value >= 28) {
                        this.violation("TR TEST D=27: CH=2 S>=28");
                    }

                    if (this.drum.read(regAR)) {
                        this.CQ.value = 1;
                    }
                    switch (this.S.value) {
                    case 24:    // MQ
                    case 25:    // ID
                    case 26:    // PN
                        if (!this.C1.value || this.drum.CE) {
                            word &= Util.absWordMask;   // zero sign bit on even word for DP
                        }
                        break;
                    }
                    this.drum.write(regAR, word);
                } else {
                    if (word) {
                        this.CQ.value = 1;
                    }
                }
                break;
            case 3: // SU ("subtract": change sign)
                if (this.CS.value) {
                    if (this.S.value >= 28) {
                        this.violation("TR TEST D=27: CH=3 S>=28");
                    }

                    if (this.drum.read(regAR)) {
                        this.CQ.value = 1;
                    }
                    this.drum.write(regAR, this.complementDoubleOdd(word));
                } else {
                    if (word) {
                        this.CQ.value = 1;
                    }
                }
                break;
            } // switch this.C
        });
    }

    /**************************************/
    transferToID() {
        /* Executes a transfer from any source to the ID register (D=25) */

        this.transferDriver(() => {
            let word = 0;

            switch (this.C.value) {
            case 0: // TR
                word = this.readSource();
                switch (this.S.value) {
                case 24:    // MQ
                case 25:    // ID
                case 26:    // PN
                    if (!this.C1.value || this.drum.CE) {
                        word &= Util.absWordMask;
                    }
                    break;
                default:    // S = 0..23 or 27..31
                    if (!this.C1.value || this.drum.CE) {
                        this.IP.value = word & Util.wordSignMask;       // set IP on even word for DP
                        word &= Util.absWordMask;
                    }
                    break;
                } // switch this.S

                this.drum.write(regID, word & Util.absWordMask);
                this.drum.write(regPN, 0);     // clear this half of PN
                if (this.tracing) {
                    let loc = this.drum.L.value;
                    console.log("              ID: %2d:%3d=%s %d> ID:%d=%s IP=%d PN=0",
                            this.S.value, this.lineL(this.S.value, loc),
                            Util.g15SignedHex(word).padStart(8, " "), this.C.value,
                            loc%2, Util.g15SignedHex(this.drum.read(regID)).padStart(8, " "),
                            this.IP.value);
                }
                break;

            case 2: // TVA/AV
                word = this.readSource();
                switch (this.S.value) {
                case 24:    // MQ
                case 25:    // ID
                case 26:    // PN
                    if (this.drum.CE) {                 // even word time
                        this.drum.write(regID, 0);      // clear ID-0
                        this.drum.write(regAR, word & Util.absWordMask);
                    } else {                            // odd word time
                        this.drum.write(regID, this.drum.read(regAR));// copy AR to ID-1
                        if (this.C1.value) {            // double-precision
                            this.drum.write(regAR, word);
                        } else {
                            this.drum.write(regAR, word & Util.absWordMask);
                        }
                    }
                    break;
                case 28:    // AR
                case 29:    // 20.IR
                case 30:    // 20/.21
                case 31:    // 20.21
                    if (!this.C1.value || this.drum.CE) {
                        this.drum.write(regID, word & Util.absWordMask);
                    } else {
                        this.drum.write(regID, word);
                    }
                    break;
                default:    // S = 0..23 or 27
                    if (this.drum.CE) {         // even word time
                        this.drum.write(regID, 0);                 // clear ID-0
                        this.drum.write(regAR, word & Util.absWordMask);
                        this.IP.value = word & Util.wordSignMask;
                    } else {                    // odd word time
                        this.drum.write(regID, this.drum.read(regAR));// copy AR to ID-1
                        if (this.C1.value) {                    // double-precision
                            this.drum.write(regAR, word);
                        } else {
                            this.drum.write(regAR, word & Util.absWordMask);
                            this.IP.value = word & Util.wordSignMask;
                        }
                    }
                    break;
                } // switch this.S

                this.drum.write(regPN, 0);     // clear this half of PN
                if (this.tracing) {
                    let loc = this.drum.L.value;
                    console.log("              ID: %2d:%3d=%s %d> ID:%d=%s IP=%d PN=0",
                            this.S.value, this.lineL(this.S.value, loc),
                            Util.g15SignedHex(word).padStart(8, " "), this.C.value,
                            loc%2, Util.g15SignedHex(this.drum.read(regID)).padStart(8, " "),
                            this.IP.value);
                }
                break;

            default:    // odd characteristics work as if for a normal line
                this.transformNormal();
                break;
            } // switch this.C
        });
    }

    /**************************************/
    transferToMQPN(dest) {
        /* Executes a transfer from any source to the MQ or PN registers (D=24,
        26, respectively). There are some slight differences between D=24 and
        D=26 when copying two-word registers with characteristic=0 */

        this.transferDriver(() => {
            let word = 0;

            switch (this.C.value) {
            case 0: // TR
                word = this.readSource();
                switch (this.S.value) {
                case 24:    // MQ
                case 25:    // ID
                    if (!this.C1.value || this.drum.CE) {
                        this.drum.write(dest, word & Util.absWordMask);
                    } else {
                        this.drum.write(dest, word);
                    }
                    break;
                case 26:    // PN
                    if (dest == regPN) {        // PN -> PN
                        if (!this.C1.value || this.drum.CE) {
                            word = (word & Util.absWordMask) | this.IP.value;
                            this.drum.write(dest, this.complementSingle(word));
                        } else {
                            this.drum.write(dest, this.complementDoubleOdd(word));
                        }
                    } else {                    // PN -> MQ works like ID/MQ -> MQ
                        if (!this.C1.value || this.drum.CE) {
                            this.drum.write(dest, word & Util.absWordMask);
                        } else {
                            this.drum.write(dest, word);
                        }
                    }
                    break;
                default:    // S = 0..23 or 27..31
                    if (!this.C1.value || this.drum.CE) {
                        this.drum.write(dest, word & Util.absWordMask);
                        if (word & Util.wordSignMask) {
                            this.IP.flip();     // reverse IP if word is negative
                        }
                    } else {                    // odd word and DP
                        this.drum.write(dest, word);
                    }
                    break;
                } // switch this.S

                if (this.tracing) {
                    let mnem = (dest == regMQ ? "MQ" : "PN");
                    let loc = this.drum.L.value;
                    console.log("              %s: %2d:%3d=%s %d> %s:%d=%s IP=%d",
                            mnem, this.S.value, this.lineL(this.S.value, loc),
                            Util.g15SignedHex(word).padStart(8, " "), this.C.value,
                            mnem, loc%2, Util.g15SignedHex(this.drum.read(dest)).padStart(8, " "),
                            this.IP.value);
                }
                break;

            case 2: // TVA
                word = this.readSource();
                switch (this.S.value) {
                case 24:    // MQ
                case 25:    // ID
                case 26:    // PN
                    if (this.drum.CE) {                         // even word time
                        this.drum.write(dest, 0);               // clear dest-even
                        this.drum.write(regAR, word & Util.absWordMask);
                    } else {
                        this.drum.write(dest, this.drum.read(regAR));      // copy AR to dest-odd
                        if (this.C1.value) {                    // double-precision
                            this.drum.write(regAR, word);
                        } else {
                            this.drum.write(regAR, word & Util.absWordMask);
                        }
                    }

                    if (this.tracing) {
                        let mnem = (dest == regMQ ? "MQ" : "PN");
                        let loc = this.drum.L.value;
                        console.log("              %s: %2d:%3d=%s %d> AR=%s, AR > %s:%d=%s IP=%d",
                                mnem, this.S.value, this.lineL(this.S.value, loc),
                                Util.g15SignedHex(word).padStart(8, " "), this.C.value,
                                Util.g15SignedHex(this.drum.read(regAR)),
                                mnem, loc%2, Util.g15SignedHex(this.drum.read(dest)).padStart(8, " "),
                                this.IP.value);
                    }
                    break;
                case 28:    // AR
                case 29:    // 20.IR
                case 30:    // 20/.21
                case 31:    // 20.21
                    if (!this.C1.value || this.drum.CE) {
                        this.drum.write(dest, word & Util.absWordMask);
                    } else {
                        this.drum.write(dest, word);
                    }

                    if (this.tracing) {
                        let mnem = (dest == regMQ ? "MQ" : "PN");
                        let loc = this.drum.L.value;
                        console.log("              %s: %2d:%3d=%s %d> %s:%d=%s IP=%d",
                                mnem, this.S.value, this.lineL(this.S.value, loc),
                                Util.g15SignedHex(word).padStart(8, " "), this.C.value,
                                mnem, loc%2, Util.g15SignedHex(this.drum.read(dest)).padStart(8, " "),
                                this.IP.value);
                    }
                    break;
                default:    // S = 0..23 or 27
                    if (this.drum.CE) {         // even word time
                        this.drum.write(dest, 0);               // clear even side of dest
                        this.drum.write(regAR, word & Util.absWordMask);
                        if (word & Util.wordSignMask) {
                            this.IP.flip();     // reverse IP if word is negative
                        }
                    } else {
                        this.drum.write(dest, this.drum.read(regAR)); // copy AR to dest-odd
                        if (this.C1.value) {                    // double-precision
                            this.drum.write(regAR, word);
                        } else {
                            this.drum.write(regAR, word & Util.absWordMask);
                            if (word & Util.wordSignMask) {
                                this.IP.flip();     // reverse IP if word is negative
                            }
                        }
                    }

                    if (this.tracing) {
                        let mnem = (dest == regMQ ? "MQ" : "PN");
                        let loc = this.drum.L.value;
                        console.log("              %s: %2d:%3d=%s %d> AR=%s, AR > %s:%d=%s IP=%d",
                                mnem, this.S.value, this.lineL(this.S.value, loc),
                                Util.g15SignedHex(word).padStart(8, " "), this.C.value,
                                Util.g15SignedHex(this.drum.read(regAR)),
                                mnem, loc%2, Util.g15SignedHex(this.drum.read(dest)).padStart(8, " "),
                                this.IP.value);
                    }
                    break;
                } // switch this.S
                break;

            default:    // odd characteristics work as if for a normal line
                this.transformNormal();
                break;
            } // switch this.C
        });
    }

    /**************************************/
    transferToAR() {
        /* Executes a transfer from any source to the AR register (D=28). Note
        that for D=28, "via AR" operations are not supported, and instead
        characteristics 2 & 3 perform absolute value and negation, respectively */

        this.transferDriver(() => {
            let a = 0;                          // value written to AR
            let word = this.readSource();       // original source word

            switch (this.C.value) {
            case 0: // TR
                a = word;
                break;

            case 1: // AD
                if (!this.C1.value || this.drum.CE) {           // SP operation or even word
                    a = this.complementSingle(word);
                } else {                // DP odd word
                    a = this.complementDoubleOdd(word);
                }
                break;

            case 2: // AV
                a = word & Util.absWordMask;
                break;

            case 3: // SU
                if (!this.C1.value || this.drum.CE) {           // SP operation or even word
                    a = this.complementSingle(word ^ 1);                // change sign bit
                } else {                // DP odd word
                    a = this.complementDoubleOdd(word);
                }
                break;
            } // switch this.C

            this.drum.write(regAR, a);
            if (this.tracing) {
                let loc = this.drum.L.value;
                console.log("              AR: %2d:%3d=%s %d> AR=%s",
                        this.S.value, this.lineL(this.S.value, loc),
                        Util.g15SignedHex(word).padStart(8, " "), this.C.value,
                        Util.g15SignedHex(a).padStart(8, " "));
            }
        });
    }

    /**************************************/
    addToAR() {
        /* Executes an addition from any source to the AR register (D=29).
        AR is assumed to be in complement form. Sets OVERFLOW if necessary */

        this.transferDriver(() => {
            let a = this.drum.read(regAR);      // original value of AR
            let b = 0;                          // effective augend
            let sum = 0;                        // sum to be written to AR
            let word = this.readSource();       // original value of augend

            switch (this.C.value) {
            case 0: // TR
                b = word;
                break;

            case 1: // AD
                if (!this.C1.value || this.drum.CE) {   // SP operation or even word
                    b = this.complementSingle(word);
                } else {                // DP odd word
                    b = this.complementDoubleOdd(word);
                }
                break;

            case 2: // AV
                if (!this.C1.value || this.drum.CE) {   // SP operation or even word
                    b = word & Util.absWordMask;
                } else {                // DP odd word
                    b = this.complementDoubleOdd(word);
                }
                break;

            case 3: // SU
                if (!this.C1.value || this.drum.CE) {   // SP operation or even word
                    b = this.complementSingle(word ^ 1);        // change sign bit
                } else {                // DP odd word
                    b = this.complementDoubleOdd(word);
                }
                break;
            } // switch this.C

            sum = this.addSingle(a, b);
            if (this.overflowed) {
                this.FO.value = 1;
            }

            this.drum.write(regAR, sum);
            if (this.tracing) {
                let loc = this.drum.L.value;
                console.log("              AR+ %2d:%3d=%s %d> %s + AR=%s : %s FO=%d%s",
                        this.S.value, this.lineL(this.S.value, loc),
                        Util.g15SignedHex(word).padStart(8, " "), this.C.value,
                        Util.g15SignedHex(b).padStart(8, " "),
                        Util.g15SignedHex(a).padStart(8, " "),
                        Util.g15SignedHex(sum).padStart(8, " "),
                        this.FO.value, (this.overflowed ? "*" : " "));
            }
        });
    }

    /**************************************/
    incrementAR() {
        /* Adds 1 to the AR register. AR is assumed to be in complement form.
        If the addition overflows, sets AR to 0 but does not set the FO flip-flop.
        Returns the new value of AR */
        let a = this.drum.read(regAR);

        if (a == Util.absWordMask) {
            a = 0;                      // simulate AR overflow without affecting FO
        } else {
            a = this.addSingle(a, 2);   // increment the low-order magnitude bit
        }

        this.drum.write(regAR, a);
        return a;
    }

    /**************************************/
    addToPN() {
        /* Executes an addition from any source to the PN register (D=30) */
        this.pnAddCarry = 0;            // carry bit from even word to odd word
        this.pnAddendSign = 0;          // raw sign result from even word addition
        this.pnAugendSign = 0;          // sign of augend (PN)
        this.pnEvenAddendMag = 0;       // magnitude of even word
        this.pnEvenSumZero = false;     // result of even-word addition is zero
        this.pnSign = 0;                // final sign to be applied to PN

        this.transferDriver(() => {
            let isEven = (this.drum.CE);        // at even word
            let pw = this.drum.read(regPN);     // current PN word
            let word = this.readSource();       // current source word

            if (!this.C1.value || isEven) {     // even word or not DP
                switch (this.C.value) {
                case 0: // TR
                    pw = this.addDoubleEven(pw, word);
                    break;
                case 1: // AD
                    pw = this.addDoubleEven(pw, this.complementSingle(word));
                    break;
                case 2: // AV           // since it's absolute value, no complementing is necessary
                    pw = this.addDoubleEven(pw, word & Util.absWordMask);
                    break;
                case 3: // SU
                    pw = this.addDoubleEven(pw, this.complementSingle(word ^ 1)); // change sign bit
                    break;
                }

                this.drum.write(regPN, pw);
            } else {                            // DP odd word
                switch (this.C.value) {
                case 0: // TR
                    pw = this.addDoubleOdd(pw, word);
                    break;
                case 1: // AD
                    pw = this.addDoubleOdd(pw, this.complementDoubleOdd(word));
                    break;
                case 2: // AV           // since it's absolute value, no complementing is necessary
                    pw = this.addDoubleOdd(pw, word);
                    break;
                case 3: // SU
                    pw = this.addDoubleOdd(pw, this.complementDoubleOdd(word));
                    break;
                }

                if (this.overflowed) {
                    this.FO.value = 1;
                }

                this.drum.write(regPN, pw);

                // Apply the final sign of the addition to the even word of PN
                this.drum.setPN0T1Bit(this.pnSign);
            }

            if (this.tracing) {
                this.traceRegisters();
            }
        });
    }

    /**************************************/
    multiply() {
        /* Multiplies the contents of the ID register by the contents of the
        MQ register, developing the double-precision product in the PN register.
        The command should be coded as immediate and be in an odd location so
        that transfer starts on an even word. The C (characteristic) and C1
        (double-precision) bits in the command are ignored. T for single-precision
        operands in ID and MQ should be coded as 56 and for double-precision 114.
        Sign of the product is maintained by the IP flip-flop, not used here */
        let count = this.T.value;       // shift+add iteration count times 2
        let id = 0;                     // local copy of current ID word
        let pm = 0;                     // PM flip-flop: high-order bit of multipler

        // Initialize the register inter-word carries in case we start on an odd word.
        this.mqShiftCarry = this.drum.getMQ0T29Bit();
        this.pnAddCarry = 0;
        this.pnAddendSign = 0;
        this.pnAugendSign = 0;
        this.pnEvenAddendMag = 0;
        this.pnEvenSumZero = false;
        this.pnSign = 0;

        if (this.DI.value) {
            this.drum.waitUntil(this.T.value);
        }

        if (!this.drum.CE) {
            this.violation("Multiply starting on ODD word");
        }

        // Since T is considered relative, do a modified transfer cycle.
        do {
            if (this.drum.CE) {         // even word
                pm = this.drum.getMQ1T29Bit();  // determine whether to add in this cycle
                id = this.shiftIDRightEven();
                this.shiftMQLeftEven();
                if (pm) {
                    this.drum.write(regPN, this.addDoubleEven(this.drum.read(regPN), id));
                }
            } else {                    // odd word
                id = this.shiftIDRightOdd();
                this.shiftMQLeftOdd();
                if (pm) {
                    this.drum.write(regPN, this.addDoubleOdd(this.drum.read(regPN), id));
                }
            }

            this.drum.waitFor(1);
        } while (--count > 0);

        if (this.tracing) {
            this.traceRegisters();
        }
    }

    /**************************************/
    divide() {
        /* Divides PN by ID leaving the double-precision quotient in MQ and
        remainder in PN. This command must be coded as immediate and be in an
        odd location so that transfer starts on an even word. The C (characteristic)
        must be 1 and C1 (double-precision bit) is ignored. T for single-precision
        operands in PN and ID should normally be 57 and for double-precision 114,
        although other values can be useful. Sign of the quotient is maintained
        in the IP flip-flop, not used here */
        let count = this.T.value;       // shift+add iteration count times 2
        let id = 0;                     // current ID register word
        let pn = 0;                     // current PN register word
        let pnShiftCarry =              // inter-word carry for PN left shifts
                this.drum.getPN0T29Bit();
        let rSign = 0;                  // sign of remainder (controls add/sub on next cycle)
        let qBit = 0;                   // current quotient bit

        let oFlow = 0;                  // *** DEBUG ***
        let pna = 0;                    // *** DEBUG ***
        let pnb = 0;                    // *** DEBUG ***
        let pnc = 0;                    // *** DEBUG ***

        let debugTraceEven = () => {
            console.log("<Div> %3i %2i %8s%s %8s%s %8s%s %s%s    %2i %8s%s %2i",
                    count, this.drum.L2,
                    (id >>1).toString(16).padStart(8," "), (id  & Util.wordSignMask ? "-" : " "),
                    (pnb>>1).toString(16).padStart(8," "), (pnb & Util.wordSignMask ? "-" : " "),
                    (pna>>1).toString(16).padStart(8," "), (pna & Util.wordSignMask ? "-" : " "),
                    (rSign ? "-" : "+"), (this.pnSign ? "-" : "+"), qBit,
                    (pn >>1).toString(16).padStart(8," "), (pn  & Util.wordSignMask ? "-" : " "),
                    pnc);
        };

        let debugTraceOdd = () => {
            console.log("<Div> %3i %2i%9s %9s %9s  %s%s %2i %2i%9s  %2i",
                    count, this.drum.L2,
                    id .toString(16).padStart(9," "),
                    pnb.toString(16).padStart(9," "),
                    pna.toString(16).padStart(9," "),
                    (rSign ? "-" : "+"), (this.pnSign ? "-" : "+"), oFlow, qBit,
                    pn .toString(16).padStart(9," "),
                    pnc);
            console.log(" ");
        };

        if (this.tracing) {
            console.log(" ");
                     //        ttt     ddddddd-  bbbbbbb-  aaaaaaa- ss  f  q   ppppppp- c
            console.log("<Div>   T L2       ID     PN-B4     PN-AA  P± OF  Q       PN   C");
        }

        // Initialize the register inter-word carries in case we start on an odd word.
        this.mqShiftCarry = this.drum.getMQ0T29Bit();
        this.pnAddCarry = 0;
        this.pnAddendSign = 0;
        this.pnAugendSign = 0;
        this.pnEvenAddendMag = 0;
        this.pnEvenSumZero = false;
        this.pnSign = 0;

        if (this.DI.value) {
            this.drum.waitUntil(this.T.value);
        }

        if (!this.drum.CE) {
            this.violation("Division starting on ODD word");
        }

        // Since T is considered relative, do a modified transfer cycle.
        do {
            id = this.drum.read(regID);
            pn = this.drum.read(regPN);
            if (this.drum.CE) {         // even word
                this.drum.setMQ0T2Bit(qBit);    // insert the current quotient bit into MQ:0 T2
                this.shiftMQLeftEven();
                id = (id & Util.absWordMask) | (1-rSign);       // + or - denominator
                id = this.complementSingle(id);
                pn = (pn & Util.absWordMask) | this.pnSign;
                pnb = pn;                       // *** DEBUG ***
                pn = this.addDoubleEven(pn, id);
                pna = pn;                       // *** DEBUG ***
                pnShiftCarry = (pn >> (Util.wordBits-1)) & 1;
                pnc = pnShiftCarry;
                pn = ((pn & Util.absWordMask) << 1) & Util.wordMask;
                if (this.tracing) {             // *** DEBUG ***
                    debugTraceEven();           // *** DEBUG ***
                }                               // *** DEBUG ***
            } else {                    // odd word
                this.shiftMQLeftOdd();
                id = this.complementDoubleOdd(id);
                pnb = pn;                       // *** DEBUG ***
                pn = this.addDoubleOdd(pn, id);
                rSign = this.pnSign;            // controls add/subtract of denominator in next cycle
                pna = pn;                       // *** DEBUG ***
                oFlow = this.FO.value;          // *** DEBUG ***
                if (this.FO.value) {            // overflows can happen with negative remainders...
                    this.FO.value = 0;          //     ...ignore them
                }

                pnc = (pn >> (Util.wordBits-1));// *** DEBUG ***
                this.pnSign = (pn >> (Util.wordBits-1)) & 1;    // new PN sign after shifting
                pn = ((pn << 1) & Util.absWordMask) | pnShiftCarry;

                qBit = 1-rSign;                 // determine the quotient bit from the remainder sign
                if (this.tracing) {             // *** DEBUG ***
                    debugTraceOdd();            // *** DEBUG ***
                }                               // *** DEBUG ***
            }

            this.drum.write(regPN, pn);
            this.drum.waitFor(1);
        } while (--count > 0);

        if (this.mqShiftCarry) {                // quotient overflow
            this.overflowed = true;                     // for tracing output only
            this.FO.value = 1;
        }

        this.drum.setMQ0T2Bit(1);               // Princeton roundoff to quotient

        if (this.tracing) {
            this.traceRegisters();
        }
    }

    /**************************************/
    shiftMQLeftIDRight() {
        /* Shifts MQ left and ID right by one bit for every two word times.
        The command should be coded as immediate and be in an odd location so
        that transfer starts on an even word. The C1 (double-precision) bit in
        the command is ignored. Shifting is terminated when the T count is
        exhausted. If the characteristic is zero, AR will be incremented by 1
        for each shift, and shifting will be terminated before the T count is
        exhausted if AR is incremented to zero or overflows */
        let count = this.T.value;               // max shift count times 2

        // Initialize the register inter-word carries.
        this.mqShiftCarry = this.drum.getMQ0T29Bit();

        if (this.DI.value) {
            this.drum.waitUntil(this.T.value);
        }

        if (!this.drum.CE) {
            this.violation("Shift MQ/ID starting on ODD word");
        }

        // Since T is considered relative, do a modified transfer cycle.
        while (count > 0) {
            if (this.drum.CE) {         // even word
                this.shiftIDRightEven();
                this.shiftMQLeftEven();
            } else {                    // odd word
                this.shiftIDRightOdd();
                this.shiftMQLeftOdd();
                if (this.C.value == 0) {        // increment AR and check for overflow
                    if (this.incrementAR() == 0) {
                        break; // out of while loop
                    }
                }
            }

            this.drum.waitFor(1);
            --count;
        }

        if (this.tracing) {
            this.traceRegisters();
        }
    }

    /**************************************/
    normalizeMQ() {
        /* Shifts the MQ register left as necessary so that the high-order bit
        of the odd word (MQ:1) is a 1. If the characteristic is 0, AR is
        incremented by 1 for every shift. Transfer is terminated whenever the
        T count (which is relative) is exhausted or the high-order bit of MQ
        becomes 1. If the word is initially normalized, no shift occurs. The
        command must be coded immediate and located an odd word time so that
        transfer will start on an even word time. The C1 (double-precision) bit
        is ignored */
        let count = this.T.value;               // max shift count times 2
        let pm = this.drum.getMQ1T29Bit();      // PM flip-flop: high-order bit of multipler

        // Initialize the register inter-word carry.
        this.mqShiftCarry = this.drum.getMQ0T29Bit();

        if (this.DI.value) {
            this.drum.waitUntil(this.T.value);
        }

        if (!this.drum.CE) {
            this.violation("Normalize MQ starting on ODD word");
        }

        // Since T is considered relative, do a modified transfer cycle.
        while (!pm && count > 0) {
            if (this.drum.CE) {         // even word
                this.shiftMQLeftEven();
            } else {                    // odd word
                this.shiftMQLeftOdd();
                pm = this.drum.getMQ1T29Bit();
                if (this.C.value == 0) {
                    this.incrementAR();
                }
            }

            this.drum.waitFor(1);
            --count;
        }

        if (this.tracing) {
            this.traceRegisters();
        }
    }


    /*******************************************************************
    *  Input/Output Subsystem                                          *
    *******************************************************************/

    /**************************************/
    async receiveInputCode(code) {
        /* Receives the next I/O code from an input device and either stores
        it onto the drum or acts on its control function */
        let eob = false;                // end-of-block flag

        this.drum.ioStartTiming();

        if ((this.OC.value & 0b01111) == 0) {
            eob = true;                         // canceled or invalid call
        } else {
            if (code & IOCodes.ioDataMask) {    // it's a data frame
                await this.drum.ioPrecessCodeTo23(code, 4);
                this.ioBitCount += 4;
            } else {
                switch(code & 0b00111) {
                case IOCodes.ioCodeMinus:       // minus: set sign FF
                    this.OS.value = 1;
                    break;
                case IOCodes.ioCodeCR:          // carriage return: shift sign into word
                case IOCodes.ioCodeTab:         // tab: shift sign into word
                    await this.drum.ioPrecessCodeTo23(this.OS.value, 1);
                    this.OS.value = 0;
                    ++this.ioBitCount;
                    break;
                case IOCodes.ioCodeStop:        // end/stop
                    eob = true;
                    // no break: Stop implies Reload
                case IOCodes.ioCodeReload:      // reload
                    await this.ioPromise;
                    await this.drum.ioCopy23ToMZ();
                    this.ioPromise = this.drum.ioPrecessMZTo19();
                    this.ioBitCount = 0;
                    break;
                case IOCodes.ioCodePeriod:      // period: ignored
                    break;
                case IOCodes.ioCodeWait:        // wait: insert a 0 digit on input
                    await this.drum.ioPrecessCodeTo23(0, 4);
                    this.ioBitCount += 4;
                    break;
                default:                        // treat everything else as space & ignore
                    break;
                }
            }

            // Check if automatic reload is enabled
            if (this.AS.value && this.ioBitCount >= Util.fastLineSize*Util.wordBits) {
                await this.drum.ioCopy23ToMZ();
                await this.drum.ioPrecessMZTo19();
                this.ioBitCount = 0;
            }
        }

        return eob;
    }

    /**************************************/
    async executeKeyboardCommand(code) {
        /* Executes the typewriter keyboard command specified by:
            * If the code is negative, then the ASCII value of "code"
            * If the code is 0b10000-0b10111 (keyboard 1-7), then sets
                the command line to the value of that code */

        switch (code) {
        case -0x41: case -0x61:         // A - Type out AR
            this.typeAR();
            break;
        case -0x42: case -0x62:         // B - Back up paper tape one block
            await this.reversePaperTapePhase1();
            break;
        case -0x43: case -0x63:         // C - Select command line
            this.setCommandLine(0);
            break;
        case -0x46: case -0x66:         // F - Set first word of command line
            this.stop();
            this.drum.waitUntil(0);
            this.drum.throttle();
            this.N.value = 0;
            this.drum.CM.value &= Util.wordMask & ~0b11111_11111_0;     // clear any mark
            break;
        case -0x49: case -0x69:         // I - Initiate single cycle
            this.step();
            break;
        case -0x4D: case -0x6D:         // M - Mark place
            this.drum.waitUntil(107);
            this.drum.throttle();
            this.drum.write(0, this.drum.CM.value ^ Util.wordMask);
            this.drum.write(1, this.drum.read(regAR));
            break;
        case -0x50: case -0x70:         // P - Start paper tape reader
            this.stop();
            this.drum.waitUntil(0);
            this.drum.throttle();
            this.N.value = 0;
            this.setCommandLine(7);
            await this.readPaperTape();
            break;
        case -0x51: case -0x71:         // Q - Permit type in
            if (this.OC.value == IOCodes.ioCmdReady) {
                this.OC.value = IOCodes.ioCmdTypeIn;
            }
            break;
        case -0x52: case -0x72:         // R - Return to marked place
            this.drum.waitUntil(107);
            this.drum.throttle();
            this.drum.CM.value = this.drum.read(0) ^ Util.wordMask;
            this.drum.write(regAR, this.drum.read(1));
            break;
        case -0x54: case -0x74:         // T - Copy command location to AR high-order bits
            this.drum.write(regAR, (this.N.value << 21) | ((this.N.value ? 0 : 1) << 28) |
                (this.drum.read(regAR) & 0b0_0000000_1_1111111_11_11111_11111_1));
            break;
        case 0b10000:                   // 0 - Set command line
        case 0b10001:                   // 1
        case 0b10010:                   // 2
        case 0b10011:                   // 3
        case 0b10100:                   // 4
        case 0b10101:                   // 5
        case 0b10110:                   // 6
        case 0b10111:                   // 7
            this.setCommandLine(this.CD.value | (code & 0b00111));
            break;
        case IOCodes.ioCodeStop:        // S - Cancel I/O
            this.cancelIO();
            break;
        }
    }

    /**************************************/
    async receiveKeyboardCode(code) {
        /* Processes a keyboard code sent from ControlPanel. If the code is
        negative, it is the ASCII code for a control command used with the ENABLE
        switch. Otherwise it is an I/O data/control code to be processed as
        TYPE IN (D=31, S=12) input . Note that an "S" key can be used for
        both purposes depending on the state of this.enableSwitch */

        if (this.enableSwitch) {                                // Control command
            await this.executeKeyboardCommand(code);
        } else if (this.OC.value == IOCodes.ioCmdTypeIn) {      // Input during TYPE IN
            await this.receiveInputCode(code);
            if (code == IOCodes.ioCodeStop && this.OC.value == IOCodes.ioCmdTypeIn) { // check for cancel
                this.finishIO();
            }
        }
    }

    /**************************************/
    async formatOutputCharacter(fmt, precessor) {
        /* Generates the necessary output for one format code, fmt, returning
        the code to be output to the device. If the AS flip-flop is set and the
        precessor function indicates that the line is now empty (all zeroes),
        unconditionally returns a Stop code */
        let code = 0;                   // I/O code for the device
        let zeroed = false;             // precessor function reports line 19 all zeroes

        switch (fmt) {
        case 0b000:     // digit
            [code, zeroed] = await precessor(4);
            if (zeroed && this.AS.value) {
                code = IOCodes.ioCodeStop;      // AN auto stop
            } else {
                code |= IOCodes.ioDataMask;
            }
            break;
        case 0b001:     // end/stop
            code = IOCodes.ioCodeStop;
            break;
        case 0b010:     // carriage return - precess and discard the sign bit
            [code, zeroed] = await precessor(1);
            if (zeroed && this.AS.value) {
                code = IOCodes.ioCodeStop;      // AN auto stop
            } else {
                code = IOCodes.ioCodeCR;
            }
            break;
        case 0b011:     // period
            code = IOCodes.ioCodePeriod;
            break;
        case 0b100:     // sign - generates either a SPACE (00000) or MINUS (00001) code
            code = this.OS.value;
            break;
        case 0b101:     // reload
            code = IOCodes.ioCodeReload;
            break;
        case 0b110:     // tab - precess and discard the sign bit
            [code, zeroed] = await precessor(1);
            if (zeroed && this.AS.value) {
                code = IOCodes.ioCodeStop;      // AN auto stop
            } else {
                code = IOCodes.ioCodeTab;
            }
            break;
        case 0b111:     // wait - precess and discard the digit
            [code, zeroed] = await precessor(4);
            if (zeroed && this.AS.value) {
                code = IOCodes.ioCodeStop;      // AN auto stop
            } else {
                code = IOCodes.ioCodeWait;
            }
            break;
        }

        return [code, zeroed];
    }

    /**************************************/
    async punchLine19() {
        /* Punches the contents of line 19, starting with the four high-order
        bits of of word 107, and precessing the line with each character until
        the line is all zeroes. One character is output every two word times */
        let code = 0;                   // output character code
        let fmt = 0;                    // format code
        let line19Empty = false;        // line 19 is now empty
        let punching = true;            // true until STOP or I/O cancel
        let zeroed = false;             // precessor function reports line 19 all zeroes

        const punchPeriod = Util.drumCycleTime*2;

        this.OC.value = IOCodes.ioCmdPunch19;
        this.activeIODevice = this.devices.paperTapePunch;

        this.drum.ioStartTiming();
        let outTime = this.drum.ioTime + punchPeriod;

        // Output an initial SPACE code (a quirk of the Slow-Out logic)
        await this.devices.paperTapePunch.write(IOCodes.ioCodeSpace);
        await this.ioTimer.delayUntil(outTime);
        outTime += punchPeriod;

        // Start a MZ reload cycle.
        do {
            fmt = await this.drum.ioPrecessLongLineToMZ(2, 3);  // get initial 3-bit format code

            // The character cycle.
            do {
                this.OS.value = this.drum.ioDetect19Sign107();
                [code, zeroed] = await this.formatOutputCharacter(fmt, this.boundIOPrecess19ToCode);
                if (zeroed) {
                    line19Empty = true;
                }

                switch (code) {
                case IOCodes.ioCodeStop:
                    if (line19Empty) {
                        punching = false;
                    } else {
                        code = IOCodes.ioCodeReload;
                    }
                    break;
                }

                if (this.OC.value != IOCodes.ioCmdPunch19) {
                    punching = false;   // I/O canceled
                } else {
                    this.devices.paperTapePunch.write(code);    // no await
                    await this.ioTimer.delayUntil(outTime);
                    outTime += punchPeriod;

                    // The following is specifically intended to aid in punching
                    // blank leader. It tries to simulate what happens when a second
                    // Punch Line 19 is executed while a prior one is still in progress.
                    if (this.duplicateIO) {
                        fmt = await this.drum.ioPrecessLongLineToMZ(2, 3);      // get initial 3-bit format code
                    } else {
                        fmt = await this.drum.ioPrecessMZToCode(3);             // get next 3-bit format code
                    }
                }
            } while (code != IOCodes.ioCodeReload && punching);
        } while (punching);

        if (this.OC.value == IOCodes.ioCmdPunch19) {    // check for cancel
            this.finishIO();
        }
    }

    /**************************************/
    async typeAR() {
        /* Types the contents of AR, starting with the four high-order
        bits of the word, and precessing the word with each character */
        let code = 0;                   // output character code
        let fmt = 0;                    // format code
        let printing = true;            // true until STOP or I/O cancel
        let suppressing = false;        // zero suppression in force
        let zeroed = false;             // (ignored for AR typeout)

        const printPeriod = Util.drumCycleTime*4;

        this.OC.value = IOCodes.ioCmdTypeAR;
        this.activeIODevice = this.devices.typewriter;

        this.drum.ioStartTiming();
        let outTime = this.drum.ioTime + printPeriod;
        this.ioBitCount = 1;            // account for the sign bit

        // Start a MZ reload cycle.
        do {
            fmt = await this.drum.ioPrecessLongLineToMZ(3, 3);  // get initial format code
            suppressing = (this.punchSwitch != 1);

            // The character cycle.
            do {
                this.OS.value = this.drum.AR.value & Util.wordSignMask; // detect AR sign before precession
                [code, zeroed] = await this.formatOutputCharacter(fmt, this.boundIOPrecessARToCode);

                // Not sure if the following is correct, but it appears from the
                // Theory of Operation manual that once all bits have been processed
                // from AR, an automatic stop occurs at the next digit fetch.
                if ((code & IOCodes.ioDataMask) == IOCodes.ioDataMask) { // a digit coming from the drum
                    if (this.ioBitCount >= Util.wordBits) {
                        printing = false;       // AR completely processed
                        break;                  // out of inner do loop & exit
                    }
                }

                switch (code) {
                case IOCodes.ioDataMask:        // digit zero
                    this.ioBitCount += 4;
                    if (suppressing) {
                        code = IOCodes.ioCodeSpace;
                    }
                    break;
                case IOCodes.ioCodeCR:
                case IOCodes.ioCodeTab:
                    suppressing = (this.punchSwitch != 1);      // establish suppression for next word
                    break;
                case IOCodes.ioCodeSpace:       // used for +sign
                case IOCodes.ioCodeMinus:
                case IOCodes.ioCodeReload:
                case IOCodes.ioCodeWait:
                    // does not affect suppression
                    break;
                case IOCodes.ioCodeStop:
                    printing = false;
                    break;
                case IOCodes.ioCodePeriod:
                    suppressing = false;
                    break;
                default:                        // all non-zero digit codes turn off suppression
                    this.ioBitCount += 4;
                    suppressing = false;
                    break;
                }

                // Pause printing while the ENABLE switch is on
                while (this.enableSwitch && this.OC.value == IOCodes.ioCmdTypeAR) {
                    await this.ioTimer.delayUntil(outTime);
                    outTime += printPeriod;
                }

                if (this.OC.value != IOCodes.ioCmdTypeAR) {
                    printing = false;   // I/O canceled
                } else {
                    this.devices.typewriter.write(code);        // no await
                    if (this.punchSwitch == 1) {
                        this.devices.paperTapePunch.write(code);
                    }

                    await this.ioTimer.delayUntil(outTime);
                    outTime += printPeriod;
                    fmt = await this.drum.ioPrecessMZToCode(3); // get next 3-bit format code
                }
            } while (code != IOCodes.ioCodeReload && printing);
        } while (printing);

        if (this.OC.value == IOCodes.ioCmdTypeAR) {     // check for cancel
            this.finishIO();
        }
    }

    /**************************************/
    async typeLine19() {
        /* Types the contents of line 19, starting with the four high-order
        bits of word 107, and precessing the line with each character until
        the line is all zeroes. One character is output every four word times */
        let code = 0;                   // output character code
        let fmt = 0;                    // format code
        let line19Empty = false;        // line 19 is now all zeroes
        let printing = true;            // true until STOP or I/O cancel
        let suppressing = false;        // zero suppression in force
        let zeroed = false;             // precessor function reports line 19 all zeroes

        const printPeriod = Util.drumCycleTime*4;

        this.OC.value = IOCodes.ioCmdType19;
        this.activeIODevice = this.devices.typewriter;

        this.drum.ioStartTiming();
        let outTime = this.drum.ioTime + printPeriod;

        // Start a MZ reload cycle.
        do {
            fmt = await this.drum.ioPrecessLongLineToMZ(2, 3);  // get initial format code
            suppressing = (this.punchSwitch != 1);

            // The character cycle.
            do {
                this.OS.value = this.drum.ioDetect19Sign107();
                [code, zeroed] = await this.formatOutputCharacter(fmt, this.boundIOPrecess19ToCode);
                if (zeroed) {
                    line19Empty = true;
                }

                switch (code) {
                case IOCodes.ioDataMask:        // digit zero
                    if (suppressing) {
                        code = IOCodes.ioCodeSpace;
                    }
                    break;
                case IOCodes.ioCodeCR:
                case IOCodes.ioCodeTab:
                    suppressing = (this.punchSwitch != 1);      // establish suppression for next word
                    break;
                case IOCodes.ioCodeSpace:
                case IOCodes.ioCodeMinus:
                case IOCodes.ioCodeReload:
                case IOCodes.ioCodeWait:
                    // does not affect suppression
                    break;
                case IOCodes.ioCodeStop:
                    if (line19Empty) {
                        printing = false;
                    } else {
                        code = IOCodes.ioCodeReload;
                    }
                    break;
                default:                        // all non-zero digit codes and
                    suppressing = false;        // Period turn off suppression
                    break;
                }

                // Pause printing while the ENABLE switch is on
                while (this.enableSwitch && this.OC.value == IOCodes.ioCmdType19) {
                    await this.ioTimer.delayUntil(outTime);
                    outTime += printPeriod;
                }

                if (this.OC.value != IOCodes.ioCmdType19) {
                    printing = false;   // I/O canceled
                } else {
                    this.devices.typewriter.write(code);        // no await
                    if (this.punchSwitch == 1) {
                        this.devices.paperTapePunch.write(code);
                    }

                    await this.ioTimer.delayUntil(outTime);
                    outTime += printPeriod;
                    fmt = await this.drum.ioPrecessMZToCode(3); // get next 3-bit format code
                }
            } while (code != IOCodes.ioCodeReload && printing);
        } while (printing);

        if (this.OC.value == IOCodes.ioCmdType19) {     // check for cancel
            this.finishIO();
        }
    }

    /**************************************/
    async readPaperTape() {
        /* Reads one block from the Paper Tape Reader to line 19 via line 23 */

        this.OC.value = IOCodes.ioCmdPTRead;
        this.activeIODevice = this.devices.paperTapeReader;
        this.ioPromise = Promise.resolve();
        if (await this.devices.paperTapeReader.read()) {
            return;                     // no tape or buffer overrun -- leave I/O hanging
        } else if (this.OC.value == IOCodes.ioCmdPTRead) {      // check for cancel
            this.finishIO();
        }
    }

    /**************************************/
    async reversePaperTapePhase1() {
        /* Performs Phase 1 of paper tape search reverse, then performs Phase 2.
        Phase 1 reverses tape to the prior stop code, which is at the end of
        the prior block. Phase 2 reverses to the next stop code, which is the
        end of the block before that. It then reads forward to the next stop
        code, which will leave the tape positioned to read what originally was
        the prior block */

        this.OC.value = IOCodes.ioCmdPTRev1;
        this.activeIODevice = this.devices.paperTapeReader;
        if (await this.devices.paperTapeReader.reverseBlock()) {
            return;                     // no tape or buffer overrun -- leave I/O hanging
        } else if (this.OC.value == IOCodes.ioCmdPTRev1) {      // check for cancel
            await this.reversePaperTapePhase2();
        }
    }

    /**************************************/
    async reversePaperTapePhase2() {
        /* Performs Phase 2 of paper tape search reverse. The result is to leave
        the tape positioned to read the beginning of the current block. This is
        normally called with the reader positioned just before the stop code
        for that block. Note that the forward read will at least partially
        overwrite lines 23 and 19 */

        this.OC.value = IOCodes.ioCmdPTRev2;
        this.activeIODevice = this.devices.paperTapeReader;
        if (await this.devices.paperTapeReader.reverseBlock()) {
            return;                     // no tape or buffer overrun -- leave I/O hanging
        } else if (this.OC.value == IOCodes.ioCmdPTRev2) {      // check for cancel
            if (await this.devices.paperTapeReader.read()) {
                return;                 // no tape or buffer overrun -- leave I/O hanging
            } else if (this.OC.value == IOCodes.ioCmdPTRev2) {  // check again for cancel
                this.finishIO();
            }
        }
    }

    /**************************************/
    async enableTypeIn() {
        /* Enables input for one block from the Typewriter keyboard to line 19
        via line 23. finishIO() is handled by receiveKeyboardCode() */

        this.OC.value = IOCodes.ioCmdTypeIn;
        this.activeIODevice = this.devices.typewriter;
        this.ioPromise = Promise.resolve();
    }

    /**************************************/
    cancelIO() {
        /* Cancels any in-progress I/O operation, but leaves it not Ready
        pending a finishIO(). The individual devices will detect this and abort
        their operations */

        if (this.activeIODevice) {
            this.activeIODevice.cancel();
        }

        if (this.OC.value < IOCodes.ioCmdReady) {
            this.finishIO();
        }
    }

    /**************************************/
    finishIO() {
        /* Terminates an I/O operation, resetting state and setting Ready */

        this.OC.value = IOCodes.ioCmdReady;     // set I/O Ready state
        this.AS.value = 0;
        this.OS.value = 0;
        this.ioBitCount = 0;
        this.activeIODevice = null;
        this.duplicateIO = false;
    }

    /**************************************/
    initiateIO(sCode) {
        /* Initiates the I/O operation specified by sCode */

        // If an I/O is already in progress and this is neither a cancel request
        // nor the same I/O code, cancel the I/O.
        if (this.OC.value != IOCodes.ioCmdReady && sCode != 0) {
            if (this.OC.value == sCode) {
                this.duplicateIO = true;
                this.waitUntilT();      // same I/O as the one in progress, so
                return;                 // just ignore the request
            } else {
                this.violation(`D=31 S=${sCode}: initiateIO with I/O active, OC=${this.OC.value}`);
                sCode |= this.OC.value; // S is always OR-ed into OC, not copied
                this.cancelIO();        // cancel the in-progress I/O -- not what the G-15 did, though
            }
        }

        if (this.C1.value) {
            this.AS.value = 1;          // set automatic line 23 reload (alphanumeric systems)
        }

        switch (sCode) {
        case IOCodes.ioCmdCancel:       // 0000 cancel current I/O
            this.cancelIO();
            break;

        case IOCodes.ioCmdMTWrite:      // 0001 magnetic tape write
            this.violation(`D=31 S=${sCode} Mag Tape Write not implemented`);
            this.cancelIO();
            break;

        case IOCodes.ioCmdPunchLeader:  // 0010 fast punch leader, etc.
            this.violation(`D=31 S=${sCode} Fast Punch Leader not implemented`);
            this.cancelIO();
            break;

        case IOCodes.ioCmdFastPunch:    // 0011 fast punch line 19, etc.
            this.violation(`D=31 S=${sCode} Fast Punch Line 19 not implemented`);
            this.cancelIO();
            break;

        case IOCodes.ioCmdMTSearchRev:  // 0100 magnetic tape search, reverse
            this.violation(`D=31 S=${sCode} Mag Tape Search Reverse not implemented`);
            this.cancelIO();
            break;

        case IOCodes.ioCmdMTSearchFwd:  // 0101 magnetic tape search, forward
            this.violation(`D=31 S=${sCode} Mag Tape Search Forward not implemented`);
            this.cancelIO();
            break;

        case IOCodes.ioCmdPTRev1:       // 0110 paper tape reverse, phase 1
            this.reversePaperTapePhase1();
            break;

        case IOCodes.ioCmdPTRev2:       // 0111 paper tape reverse, phase 2
            this.reversePaperTapePhase2();
            break;

        case IOCodes.ioCmdTypeAR:       // 1000 type AR
            this.typeAR();
            break;

        case IOCodes.ioCmdType19:       // 1001 type line 19
            this.typeLine19();
            break;

        case IOCodes.ioCmdPunch19:      // 1010 paper tape punch line 19
            this.punchLine19();
            break;

        case IOCodes.ioCmdCardPunch19:  // 1011 card punch line 19
            this.violation(`D=31 S=${sCode} Card Punch not implemented`);
            this.cancelIO();
            break;

        case IOCodes.ioCmdTypeIn:       // 1100 type in
            this.enableTypeIn();
            break;

        case IOCodes.ioCmdMTRead:       // 1101 magnetic tape read
            this.violation(`D=31 S=${sCode} Mag Tape Read not implemented`);
            this.cancelIO();
            break;

        case IOCodes.ioCmdCardRead:     // 1110 card read, etc.
            this.violation(`D=31 S=${sCode} Card Read not implemented`);
            this.cancelIO();
            break;

        case IOCodes.ioCmdPTRead:       // 1111 paper tape read
            this.readPaperTape();
            break;

        default:
            this.violation(`D=31 S=${sCode} Instruction not implemented`);
            break;
        }

        this.waitUntilT();

    }


    /*******************************************************************
    *  Special (D=31) Commands                                         *
    *******************************************************************/

    /**************************************/
    returnExit() {
        /* Handles the messy details of D=31, S=20, Select Command Line and
        Return Exit. See G-15 Technical Applications Memorandum 4 and 41 */
        let loc = this.drum.L.value;
        let n = this.N.value;
        let mark = (this.drum.CM.value & 0b11_11111_11111_0) >> 1;
        let t = this.T.value;

        this.setCommandLine((this.C1.value << 2) | this.C.value);

        // Adjust the drum locations to account for wrap-around, word 107 -> 0
        if (mark < loc) {mark += Util.longLineSize}
        if (t < loc) {t += Util.longLineSize}
        if (n < loc) {n += Util.longLineSize}

        if ((this.computeSwitch == 2 && this.BP.value) || !this.CZ.value) {
            // If the Compute switch is set to BP and the command is marked BP,
            // or if single-stepping is in progress, always return to the marked
            // location and ignore N (Tech Memo 41).
            this.N.value = mark % Util.longLineSize;
        } else if (t == n) {
            // Return to the N location unconditionally (Tech Memo 4).
        } else if (t <= n && n <= mark) {
            // Return to the N location unconditionally (Tech Memo 4).
        } else {
            // Otherwise, return to the marked location
            this.N.value = mark % Util.longLineSize;
        }

        this.waitUntilT();
        if (this.tracing) {
            let dL = loc.toString().padStart(3, " ");
            let cm = Util.g15SignedHex(this.drum.CM.value).padStart(8, " ");
            let nL = this.N.value;
            console.log(`              RET L=${dL}: CM=${cm} T=${t} N=${n} MARK=${mark} => ${this.cmdLine}:${nL}`);
        }
    }

    /**************************************/
    specialCommand() {
        /* Executes a special command for D=31. The specific command is
        determined by the source (S=0-31) and characteristic */

        switch(this.S.value) {
        case 16:        // halt
            this.stop();
            this.waitUntilT();
            break;

        case 17:        // ring bell & friends
        {
            let wordTimes = this.T.value - this.drum.L.value;
            if (wordTimes <= 0) {
                wordTimes += Util.longLineSize
            }

            this.bellTiming = wordTimes;        // sensed and reset by ControlPanel
        }
            switch (this.C.value ) {
            case 1:     // ring bell and test control panel PUNCH switch
                if (this.punchSwitch == 1) {
                    this.CQ.value = 1;  // next command from N+1
                }
                break;
            case 2:     // ring bell & start INPUT REGISTER
                // INPUT REGISTER not implemented (no violation)
                break;
            case 3:     // ring bell & stop INPUT REGISTER
                // INPUT REGISTER not implemented (no violation)
                break;
            }
            this.waitUntilT();
            break;

        case 18:        // transfer M20.ID to output register
            this.transferDriver(() => {
                this.OR.value = this.drum.read(20) & this.drum.read(regID);
            });
            break;

        case 19:        // start/stop DA-1
            // this.violation(`D=31 S=${this.S.value} Start/Stop DA-1 not implemented`);
            this.waitUntilT();
            break;

        case 20:        // select command line & return exit
            this.returnExit();
            break;

        case 21:        // select command line & mark exit
            this.setCommandLine((this.C1.value << 2) | this.C.value);
            // Set the mark in T2-T13 of CM. This command takes only one word
            // time regardless of this.C1, so don't use this.transferDriver().
            // Note that if the command is immediate (DI=0), transfer state ends
            // at T-1, not T, hence the +DI-1 adjustment to the mark value.
            this.drum.CM.value = ((this.T.value + this.DI.value - 1) << 1) |
                    (this.drum.CM.value & 0b1_1111111_1_1111111_00_00000_00000_1);
            this.drum.waitUntil(this.T.value + this.DI.value);  // ignore this.C1 (DP bit)
            if (this.tracing) {
                let loc = this.drum.L.value.toString().padStart(3, " ");
                let n = this.N.value + this.DI.value - 1;
                let t = this.T.value;
                let cm = Util.g15SignedHex(this.drum.CM.value).padStart(8, " ");
                console.log(`              MRK L=${loc}: T=${t}, CM=${cm} => ${this.cmdLine}:${n}`);
            }
            break;

        case 22:        // sign of AR to TEST
            if (this.drum.read(regAR) & Util.wordSignMask) {
                this.CQ.value = 1;
            }
            this.waitUntilT();
            break;

        case 23:        // clear MQ/ID/PN/IP, etc.
            this.dpCarry = 0;
            this.dpEvenSign = 0;
            this.mqShiftCarry = 0;
            this.pnAddCarry = 0;
            this.pnAddendSign = 0;
            this.pnAugendSign = 0;
            this.pnSign = 0;
            switch (this.C.value) {
            case 0:                     // clear MQ/ID/PN/IP
                this.IP.value = 0;
                this.transferDriver(() => {
                    this.drum.write(regMQ, 0);
                    this.drum.write(regID, 0);
                    this.drum.write(regPN, 0);
                });
                break;
            case 3:                     // PN.M2 -> ID, PN.M2/ -> PN
                this.transferDriver(() => {
                    let pn = this.drum.read(regPN);
                    this.drum.write(regID, pn & this.drum.read(2));
                    this.drum.write(regPN, pn & (~this.drum.read(2)));
                });
                break;
            }

            if (this.tracing) {
                this.traceRegisters();
            }
            break;

        case 24:        // multiply
            this.multiply();
            break;

        case 25:        // divide
            this.divide();
            break;

        case 26:        // shift MQ left and ID right
            this.shiftMQLeftIDRight();
            break;

        case 27:        // normalize MQ
            this.normalizeMQ();
            break;

        case 28:        // ready, etc. to TEST
            switch (this.C.value) {
            case 0:                     // test I/O subsystem ready
                this.transferDriver(() => {
                    if (this.OC.value == IOCodes.ioCmdReady) {
                        this.CQ.value = 1;
                    }
                });
                break;
            case 1:                     // test Input Register ready
                this.waitUntilT();                   // IR not implemented
                break;
            case 2:                     // test Output Register ready
                this.waitUntilT();                   // OR not implemented
                break;
            case 3:                     // test Differential Analyzer off
                this.transferDriver(() => {
                    this.CQ.value = 1;                          // DA not implemented, always off
                });
                break;
            }
            break;

        case 29:        // test for overflow
            if (this.FO.value) {
                this.CQ.value = 1;      // next command from N+1
                this.FO.value = 0;      // test resets overflow condition
            }
            this.waitUntilT();
            break;

        case 30:        // magnetic tape write file code
            this.violation(`D=31 S=${this.S.value} Mag Tape Write File Code not implemented`);
            this.waitUntilT();
            break;

        case 31:        // odds & sods
            switch (this.C.value) {
            case 0:                     // next command from AR
                this.CG.value = 1;
                this.waitUntilT();
                break;
            case 1:                     // copy number track, OR into line 18
                this.transferDriver(() => {
                    this.drum.write(18, this.drum.read(18) | this.drum.readCN());
                });
                break;
            case 2:                     // OR line 20 into line 18
                this.transferDriver(() => {
                    this.drum.write(18, this.drum.read(18) | this.drum.read(20));
                });
                break;
            }
            break;

        default:
            this.initiateIO(this.S.value);
            break;
        }
    }


    /*******************************************************************
    *  Fetch & Execute State Control                                   *
    *******************************************************************/

    /**************************************/
    readCommand() {
        /* Reads the next command into the command register (CM) and sets up the
        processor state to execute that command */
        let cmd = 0;                    // command word
        let loc = this.N.value;         // word-time of next command

        if (this.CQ.value) {            // check the result of a prior TEST
            loc = (loc+1) % Util.longLineSize;
            this.CQ.value = 0;
        }

        this.drum.waitUntil(loc);
        if (this.CG.value) {            // next command from AR
            this.cmdLoc.value = 127;    // for display purposes only to signal "from AR"
            cmd = this.drum.read(regAR);
            this.CG.value = 0;
        } else {                        // next command from one of the CD lines
            this.cmdLoc.value = loc;
            cmd = this.drum.read(this.cmdLine);
        }

        this.C1.value = cmd & 0x01;             // single/double mode
        this.D.value =  (cmd >> 1) & 0x1F;      // destination line
        this.S.value =  (cmd >> 6) & 0x1F;      // source line
        this.C.value =  (cmd >> 11) & 0x03;     // characteristic code
        this.N.value =  (cmd >> 13) & 0x7F;     // next command location
        this.BP.value = (cmd >> 20) & 0x01;     // breakpoint flag
        this.T.value =  (cmd >> 21) & 0x7F;     // operand timing number
        this.DI.value = (cmd >> 28) & 0x01;     // immediate/deferred execution bit

        // Set "via AR" flip-flop (CX . S7/ . D7/)
        this.CS.value = (((cmd >> 12) & 1) && ((~(cmd >> 8)) & 7) && ((~(cmd >> 3)) & 7) ? 1 : 0);

        // Officially, L=107 is disqualified as a location for a command. The
        // reason is that location arithmetic is done using a 7-bit number (with
        // values 0-127) but the location following 107 is 0, not 108. The number
        // track (CN) normally handles this by increasing the N and (usually) T
        // numbers by 20 when passing location 107 to turn location 108 into
        // location 128, which in a 7-bit register is the same as zero. Alas,
        // this adjustment does not occur when a command is executed from
        // location 107, so N and (usually) T in the command will behave as if
        // they are 20 word-times too low. The following code adjusts T and N
        // so that (hopefully) they will behave as the hardware would have.

        if (loc == 107) {
            this.violation("Execute command from L=107");
            this.N.value = (this.N.value - 20 + Util.longLineSize) % Util.longLineSize;
            // Unless it's MUL, DIV, SHIFT, or NORM (D=31, S=24-27), adjust T as well
            if (!(this.D.value == 31 && (this.S.value & 0b11100) == 0b11000)) {
                this.T.value = (this.T.value - 20 + Util.longLineSize) % Util.longLineSize;
            }
        }

        // Complement T and N in CM (for display purposes only)
        this.drum.CM.value = (this.drum.CM.value & 0b1_0000000_1_0000000_11_11111_11111_1) |
                                         ((~cmd) & 0b0_1111111_0_1111111_00_00000_00000_0);

        // Transition from read-command to transfer state
        this.RC.value = 0;                      // end of read-command state
        this.TR.value = 1;                      // start of transfer state
        this.drum.waitFor(1);                   // advance past command word
        if (this.DI.value) {                    // deferred commands delay at least one word before transfer
            this.drum.waitFor(1);
        }
    }

    /**************************************/
    transfer() {
        /* Executes the command currently loaded into the command register (CM) */

        switch (this.D.value) {
        case  0:        // 108-word drum lines
        case  1:
        case  2:
        case  3:
        case  4:
        case  5:
        case  6:
        case  7:
        case  8:
        case  9:
        case 10:
        case 11:
        case 12:
        case 13:
        case 14:
        case 15:
        case 16:
        case 17:
        case 18:
        case 19:
        case 20:        // 4-word drum lines
        case 21:
        case 22:
        case 23:
            this.transferNormal();      // dispense with the low-hanging fruit

            /********** DEBUG -- Halt if we start executing zero words at location 0 *********
            if (this.tracing && this.cmdLoc.value == 0 && this.N.value == 0 &&
                    this.DI.value == 0 && this.S.value == 0 && this.D.value == 0 &&
                    this.C.value == 0) {
                this.stop();
                //debugger;
            }
            *******************************************************************/

            break;
        case 24:
            this.transferToMQPN(regMQ);
            break;
        case 25:
            this.transferToID();
            break;
        case 26:
            this.transferToMQPN(regPN)
            break;
        case 27:        // TEST for non-zero
            this.transferToTEST();
            break;
        case 28:        // copy to AR
            this.transferToAR();
            break;
        case 29:        // add to AR
            this.addToAR();
            break;
        case 30:        // add to PN
            this.addToPN();
            break;
        case 31:
            this.specialCommand();
            break;
        } // switch this.D.value

        this.TR.value = 0;              // end transfer state
        this.RC.value = 1;              // start read-command state
    }


    /*******************************************************************
    *  Processor Control                                               *
    *******************************************************************/

    /**************************************/
    async run() {
        /* Main execution control loop for the processor. Attempts to throttle
        performance to approximate that of a real G-15. The drum manages the
        system timing, updating its L and eTime properties as calls on its
        waitFor() and waitUntil() methods are made. We await drum.throttle()
        after every instruction completes to determine if drum.eTime exceeds the
        current slice time limit, in which case it delays until real time
        catches up to emulation time. We continue to run until a halt condition
        is detected */

        do {                            // run until halted
            if (this.RC.value) {        // enter READ COMMAND state
                this.readCommand();
                if (this.tracing) {
                    this.traceState();  // DEBUG ONLY
                }

                if (this.computeSwitch == 2) {  // Compute switch set to BP
                    // Do not stop on a Mark Return command; stop on the next command
                    // instead. See Tech Memo 41.
                    if  (this.deferredBP) {     // if breakpoint has been deferred, take it now
                        this.deferredBP = false;
                        this.stop();
                    } else if (this.BP.value) { // if this is a Mark Return, defer the BP
                        if (this.D.value == 31 && this.S.value == 20) {
                            this.deferredBP = true;
                        } else {
                            this.stop();
                        }
                    }
                }
            } else if (this.TR.value) { // enter TRANSFER (execute) state
                this.transfer();
                await this.drum.throttle();
                this.CZ.value = 1;      // disable stepping
            } else {
                this.violation("State neither RC nor TR");
                debugger;
                this.stop();
            }
        } while (!this.CH.value || !this.CZ.value);

        this.updateLampGlow(1);
    }

    /**************************************/
    start() {
        /* Initiates the processor on the Javascript thread */

        if (this.poweredOn && this.CH.value) {
            this.CZ.value = 1;          // disable stepping
            this.CH.value = 0;          // reset HALT FF
            this.drum.startTiming();
            this.run();                 // async -- returns immediately
        }
    }

    /**************************************/
    stop() {
        /* Stops running the processor on the Javascript thread */

        if (this.poweredOn && !this.CH.value) {
            this.CH.value = 1;          // set HALT FF
            this.CZ.value = 1;          // disable stepping
            this.CG.value = 0;          // reset Next from AR FF
            this.CQ.value = 0;          // reset TEST FF
        }
    }

    /**************************************/
    step() {
        /* Single-steps the processor. This will execute the next command
        only, then stop the processor. Note that this.CH remains set during
        the step execution */

        if (this.poweredOn && this.CH.value) {
            this.CZ.value = 0;          // enable stepping
            this.drum.startTiming();
            this.run();                 // async -- returns immediately
        }
    }

    /**************************************/
    computeSwitchChange(state) {
        /* Reacts to a change in state of the ControlPanel COMPUTE switch */

        if (this.computeSwitch != state) {
            this.computeSwitch = state;
            switch (state) {
            case 0:     // OFF
                this.stop();
                break;
            case 1:     // GO
                this.start();
                break;
            case 2:     // BP
                if (this.CH.value) {
                    this.start();
                }
                break;
            }
        }
    }

    /**************************************/
    enableSwitchChange(state) {
        /* Reacts to a change in state of the ControlPanel ENABLE switch */

        if (this.enableSwitch != state) {
            this.enableSwitch = state;
        }
    }

    /**************************************/
    punchSwitchChange(state) {
        /* Reacts to a change in state of the ControlPanel PUNCH switch */

        if (this.punchSwitch != state) {
            this.punchSwitch = state;
            switch (state) {
            case 0:     // OFF
                // ?? TBD
                break;
            case 1:     // PUNCH
                // ?? TBD
                break;
            case 2:     // REWIND
                this.devices.paperTapeReader.rewind();
                break;
            }
        }
    }

    /**************************************/
    violationSwitchChange(state) {
        /* Set the internal violation-halt flag based "state" */

        this.violationHaltSwitch = (state ? 1 : 0);
    }

    /**************************************/
    violationReset() {
        /* Resets the internal VV flip flop */

        this.VV.value = 0;
    }

    /**************************************/
    async systemReset() {
        /* Resets the system and initiates loading paper tape. Activated from
        the ControlPanel RESET button */

        if (this.tracing) {
            console.log("<System Reset>");
        }

        this.poweredOn = true;
        if (this.CH.value) {
            this.CZ.value = 1;          // enable read-command state (i.e., disable stepping)
            this.RC.value = 1;          // set read-command state
            this.TR.value = 0;          // reset transfer state
            this.CG.value = 0;          // reset Next-From-AR FF
            this.CQ.value = 0;          // reset TEST FF
            this.OC.value = IOCodes.ioCmdReady;

            // Load the Number Track, CN
            this.drum.startTiming();
            if (!await this.readPaperTape()) {
                this.drum.waitUntil(0);         // number track data to line 19
                for (let x=0; x<Util.longLineSize; ++x) {
                    this.drum.writeCN(this.drum.read(19));
                    this.drum.waitFor(1);
                }
            }

            // Load the next block from paper tape
            this.setCommandLine(7);             // execute code from line 23
            this.N.value = 0;
            await this.readPaperTape();         // read a bootstrap loader, ignore any hang
        }
    }

    /**************************************/
    powerUp() {
        /* Powers up and initializes the processor */

        if (!this.poweredOn) {
            this.CH.value = 1;                          // set HALT FF
            this.devices = this.context.devices;        // I/O device objects
            //this.loadMemory();                        // >>> DEBUG ONLY <<<
        }
    }

    /**************************************/
    powerDown() {
        /* Powers down the processor */

        this.stop();
        this.cancelIO();
        this.poweredOn = false;
    }

    /**************************************/
    loadMemory() {
        /* Loads debugging code into the initial drum memory image. The routine
        should be enabled in this.powerUp() only temporarily for demo and
        debugging purposes */

        let store = (lineNr, loc, word) => {
            if (lineNr < 20) {
                this.drum.line[lineNr][loc % Util.longLineSize] = word;
            } else if (lineNr < 24) {
                this.drum.line[lineNr][loc % Util.fastLineSize] = word;
            } else if (lineNr < 27) {
                this.drum.line[lineNr][loc % 2] = word;
            }
        };

        let asm = (lineNr, loc, di, t, n, ca, s, d, c1=0, bp=0) => {
            let word = ((((((((((((((di & 1)     << 7) |
                                    (t  & 0x7F)) << 1) |
                                    (bp & 1))    << 7) |
                                    (n  & 0x7F)) << 2) |
                                    (ca & 3))    << 5) |
                                    (s  & 0x1F)) << 5) |
                                    (d  & 0x1F)) << 1) |
                                    (c1  & 1);
            store(lineNr, loc, word);
        };

        let int = (lineNr, loc, word) => {
            let sign = 0;

            if (word < 0) {
                sign = 1;
                word = -word;
            }

            store(lineNr, loc, ((word & 0xFFFFFFF) << 1) | sign);
        };


        /***** The 4-word memory-clear wunder-kode described by Jim Horning in his blog *****/

        // First, fill the drum with non-zero values for testing
        this.drum.AR.value = 0x1234567;
        this.drum.ID[0].value = 0x2345678;
        this.drum.ID[1].value = 0x3456789;
        this.drum.MQ[0].value = 0x4567890;
        this.drum.MQ[1].value = 0x5678901;
        this.drum.PN[0].value = 0x6789012;
        this.drum.PN[1].value = 0x7890123;
        this.FO.value = 1;                              // set the overflow FF
        this.IP.value = 1;                              // set the DP sign FF
        for (let m=0; m<24; ++m) {
            for (let loc=107; loc>=0; --loc) {
                int(m, loc, (m << 16) + loc);
            }
        }

        // And now for the main event...

        //  M     L  DI    T    N  C   S   D  C1  BP
        asm(23,   0,  0,   2, 105, 0, 29, 28);          // ZERO: clear AR (accumulator)
        asm(23,   1,  0,   4,   3, 2, 23, 23);          // SWAP: precess line 23 via AR starting at L=106 thru L=3 (after first time will be L=3 thru L=3)
        asm(23,   2,  0,   4,   2, 0, 27, 29);          // CLEAR: smear zeroes to current line
        asm(23,   3,  0,   6,   2, 0, 26, 31);          // INCR: shift ID/MQ by 3 bits (6 word-times), incrementing AR by 3

        /***************************************
        // Multiplication/Division test
        int(0, 84, 0b101000);                           // division denominator
        int(0, 86, 0b011001);                           // division numerator

        //  M   L  DI   T    N  C   S   D  C1  BP
        asm(0,  0, 1,  84,   1, 2,  0, 25,  1);         // TVA multiplicand to ID
        asm(0,  1, 1,  86,   3, 2,  0, 24,  1);         // TVA multiplier to MQ

        asm(0,  3, 0,  56,   4, 0, 24, 31);             // Multiply IDxMQ > PN
        asm(0,  4, 0,   5,   5, 0, 16, 31);             // halt, then continue
        asm(0,  5, 1,   0,   6, 0, 26, 20,  1);         // DP-TR PN to 20:0
        asm(0,  6, 1,  84,   7, 2,  0, 25,  1);         // TVA divisor to ID
        //asm(0,  7, 1,   0,   9, 0, 20, 26,  1);         // DP-TR 20:0 to PN
        asm(0,  7, 1,  86,   9, 2,  0, 26,  1);         // TVA numerator/dividend to PN

        asm(0,  9, 0, 116,  99, 1, 25, 31,  1);         // divide PN/ID > MQ
        asm(0, 99, 0, 100,   0, 0, 16, 31);             // halt, then go to 0

        // Very early emulator debugging
        int(0, 90, 0);
        int(0, 91, 1);
        int(0, 92, 2);
        int(0, 95, 0xFFFFFFF);
        int(0, 96, -0xFFFFFFF);

        //  M   L  DI   T    N  C   S   D  C1  BP
        asm(0,  0, 1,  91,   1, 1,  0, 28);             // copy 1 to AR
        asm(0,  1, 1,  92,   2, 1,  0, 29);             // add 2 to AR
        asm(0,  2, 1,  96,   3, 1,  0, 29);             // add -0xFFFFFFF to AR
        asm(0,  3, 1,  95,   4, 1,  0, 29);             // add 0xFFFFFFF to AR
        asm(0,  4, 1,  95,   5, 1,  0, 29);             // add 0xFFFFFFF to AR again (overflow)
        asm(0,  5, 0,   7,   6, 0, 29, 31);             // test for overflow
        asm(0,  6, 1,  99,   8, 1, 28,  0);             // no overflow, copy AR to 0:99
        asm(0,  7, 1,  98,   8, 1, 28,  0);             // overflow, copy AR to 0:98
        asm(0,  8, 1,  91,   9, 1,  0, 28);             // copy 1 to AR
        asm(0,  9, 1,  92,  10, 3,  0, 29);             // subtract 2 from AR
        asm(0, 10, 1,  96,  11, 3,  0, 29);             // subtract -0xFFFFFFF from AR
        asm(0, 11, 0,  11,  12, 0, 17, 31);             // ring bell
        //asm(0, 12, 0,  14,  11, 0, 16, 31);             // halt, then go to ring bell

        asm(0, 12, 0,  14,  13, 0, 16, 31);             // halt
        asm(0, 13, 0,  16,  14, 0, 23, 31);             // clear ID, MQ, PN, IP
        asm(0, 14, 1,  98,  15, 2,  0, 25, 1);          // load ID from 0:98
        asm(0, 15, 1,  92,  17, 2,  0, 24, 1);          // load MQ from 0:92
        asm(0, 17, 0,  56,  18, 0, 24, 31);             // multiply ID x MQ to PN
        asm(0, 18, 0,  18,  18, 0, 16, 31);             // halt

        //asm(0, 12, 0,  14,  13, 0, 16, 31);             // halt
        //asm(0, 13, 0,  15,  14, 0,  9, 31);             // type line 19
        //asm(0, 14, 0,  16,  14, 0, 16, 31);             // loop on halt
        ***************************************/
    }

} // class Processor


// Static class properties

Processor.CDXlate = [0, 1, 2, 3, 4, 5, 19, 23];         // translate CD register to drum line numbers
