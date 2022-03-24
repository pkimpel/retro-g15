/***********************************************************************
* retro-g15/emulator Processor.js
************************************************************************
* Copyright (c) 2021, Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* JavaScript class module for the G-15 processor.
************************************************************************
* 2021-12-10  P.Kimpel
*   Original version.
***********************************************************************/

export {Processor}

import * as Util from "./Util.js";
import {Drum} from "./Drum.js";
import {FlipFlop} from "./FlipFlop.js";
import {Register} from "./Register.js";

import * as IOCodes from "./IOCodes.js";

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
        this.AS = new FlipFlop(this.drum, false);       // Automatic/Standard PPT reload FF (AN models only)
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

        // Registers (additional registers are part of this.drum)
        this.CA = new Register( 2, this.drum, false);   // characteristic bits in command
        this.CD = new Register( 3, this.drum, false);   // current command-line designator
        this.D  = new Register( 5, this.drum, false);   // destination line in command
        this.IR = new Register(29, this.drum, true);    // input register (zero unless external circuit exists)
        this.N  = new Register( 7, this.drum, false);   // next cmd location in command
        this.OC = new Register( 5, this.drum, false);   // I/O operation code register (bit 5 = READY)
        this.OR = new Register(29, this.drum, true);    // output register (a sink unless external circuit exists)
        this.S  = new Register( 5, this.drum, false);   // source line in command
        this.T  = new Register( 7, this.drum, false);   // timing number from command
        this.cmdLoc = new Register(7, this.drum, false);// current command word-time

        // General emulator state
        this.cmdLine = 0;                               // current actual command line (see CDXlate)
        this.dpCarry = 0;                               // inter-word carry bit for double-precision
        this.evenSign = 0;                              // sign of the even word of a double-precision pair
        this.deferredBP = false;                        // breakpoint deferred due to return exit cmd
        this.poweredOn = false;                         // powered up and ready to run
        this.tracing = true;                            // trace command debugging

        // UI switch state
        this.computeSwitch = 0;                         // 0=OFF, 1=GO, 2=BP
        this.enableSwitch = 0;                          // 0=normal, 1=enable typewriter keyboard
        this.punchSwitch = 0;                           // 0=off, 1=copy to paper-tape punch
        this.violationHaltSwitch = 0;                   // halt on standard-command violation

        // I/O Subsystem
        this.activeIODevice = null;                     // current I/O device object
        this.ioInputBitCount = 0;                       // current input bit count
        this.ioTimer = new Util.Timer();                // general timer for I/O operations
    }

    /**************************************/
    traceState() {
        // Log current processor state to the console

        console.warn("<TRACE>     L=%2d.%3d DI=%d T=%3d BP=%d N=%3d CA=%d S=%2d D=%2d C1=%d",
                this.cmdLine, this.cmdLoc.value, this.DI.value, this.T.value, this.BP.value,
                this.N.value, this.CA.value, this.S.value, this.D.value, this.C1.value);
    }

    /**************************************/
    violation(msg) {
        /* Posts a violation of standard-command usage */

        this.VV.value = 1;
        console.warn("<VIOLATION> L=%2d.%3d DI=%d T=%3d BP=%d N=%3d CA=%d S=2%d D=2%d C1=%d : %s",
                this.cmdLine, this.cmdLoc.value, this.DI.value, this.T.value, this.BP.value,
                this.N.value, this.CA.value, this.S.value, this.D.value, this.C1.value, msg);
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
        this.CA.updateLampGlow(gamma);
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

    /**************************************/
    setCommandLine(cmd) {
        /* Sets this.CD and this.cmdLine to specify the drum line for command
        execution */

        cmd &= 0x07;                    // only the low-order three bits
        this.CD.value = cmd;
        this.cmdLine = Processor.CDXlate[cmd];
    }

    /**************************************/
    complementSingle(word) {
        /* Converts a single-precision word or the even word of a double-
        precision pair between complement and non-complement form. The only
        case when a carry can propagate to the high-order word of a double-
        precision pair is when the low-order word is zero, so that is the
        only case when this.dpCarry is set to 1 */
        let sign = word & 1;
        let mag = word >> 1;

        this.evenSign = (this.drum.L2 ? 0 : sign);      // set to 0 on odd words
        if (mag == 0) {
            this.dpCarry = 1;
            return 0;
        } else {
            this.dpCarry = 0;
            if (sign) {                 // negative, complement
                return ((Util.two28 - mag) << 1) | sign;
            } else {                    // positive, do not complement
                return word;
            }
        }
    }

    /**************************************/
    complementDoubleOdd(word) {
        /* Converts the second word of a double-precision operand between
        complement forms, returning the converted word. this.dpCarry is assumed
        to hold any carry from complementing the even word of the pair. Any
        overflow from complementing the high-order word is discarded */

        if (this.evenSign) {            // even word was negative
            return (Util.wordMask - word + this.dpCarry) & Util.wordMask;
        } else {
            return (word + this.dpCarry) & Util.wordMask;
        }
    }

    /**************************************/
    readSource() {
        /* Reads one word from the source specified by this.S at the current
        drum location, returning the raw word value. Do not use for transferring
        between the 2-word registers, ID, PN, MQ -- those are weird */

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
                // IP is applied as sign only for even-numbered characteristics
                if (!(this.CA.value & 1)) {
                    if (!this.C1.value || this.drum.L2 == 0) {  // sign time: not DP or at even word
                        word = (word & Util.absWordMask) | this.IP;
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
            return ~this.drum.read(20) & this.drum.read(21);
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
            if (this.C1.value && this.drum.L2 == 0) {
                ++count;                // DP operand: two-word transfer state
            }
        } else {
            // Immediate execution: transfer during current word time through T-1.
            count = this.T.value - this.drum.L.value;
            if (count <= 0) {
                count += Util.longLineSize;
            }
        }

        if (this.C1.value && this.drum.L2 == 1) {
            this.violation("DP transfer starting on ODD word");
        }

        do {
            transform();
            this.drum.waitFor(1);
        } while (--count > 0);
    }

    /**************************************/
    transferNothing() {
        /* A dummy transfer method that does nothing, used to satisfy transfer
        timing when nothing else needs to be done */
    }

    /**************************************/
    transferNormal() {
        /* Executes a transfer from any source to drum lines 0-23. "Via AR"
        operations are not supported for the sources >=28, so special action
        is taken for those cases */

        this.transferDriver(() => {
            let word = this.readSource();

            switch (this.CA.value) {
            case 0: // TR (transfer)
                this.drum.write(this.D.value, word);
                break;
            case 1: // AD ("add": complement negative numbers)
                if (!this.C1.value || this.drum.L2 == 0) {      // SP operation or even word
                    word = this.complementSingle(word);
                } else {                // DP odd word
                    word = this.complementDoubleOdd(word);
                }
                this.drum.write(this.D.value, word);
                break;
            case 2: // TVA (transfer via regAR) or AV (absolute value)
                if (this.S.value < regAR) {    // transfer via AR
                    this.drum.write(this.D.value, this.drum.read(regAR));
                    this.drum.write(regAR, word);
                } else {                    // absolute value
                    if (!this.C1.value || this.drum.L2 == 0) { // SP operation or even word
                        this.drum.write(this.D.value, word & Util.absWordMask);
                    } else {                    // DP odd word
                        this.drum.write(this.D.value, word);
                    }
                }
                break;
            case 3: // AVA ("add" via AR) or SU ("subtract": change sign)
                if (this.S.value < regAR) {    // "add" via AR
                    this.drum.write(this.D.value, this.drum.read(regAR));
                    if (!this.C1.value || this.drum.L2 == 0) {  // SP operation or even word
                        this.drum.write(regAR, this.complementSingle(word));
                    } else {                    // DP odd word
                        this.drum.write(regAR, this.complementDoubleOdd(word));
                    }
                } else {                    // "subtract": reverse sign and complement if now negative
                    if (!this.C1.value || this.drum.L2 == 0) {  // SP operation or even word
                        this.drum.write(this.D.value, this.complementSingle(word ^ 1));
                    } else {                    // DP odd word
                        this.drum.write(this.D.value, this.complementDoubleOdd(word));
                    }
                }
                break;
            } // switch this.CA
        });
    }

    /**************************************/
    transferToTEST() {
        /* Executes a transfer from any source to the TEST register (D=27). If
        any single- or double-precision value is non-zero, CQ is set to cause
        the next command to be taken from N+1. Note that since the test is for
        non-zero, negative values do not need to be complemented before the test.  */

        if (this.S.value >= 28 && this.CA.value >= 2) {
            this.violation("TR D=27: CH>=2 S=>28");
        }

        this.transferDriver(() => {
            let word = this.readSource();

            switch (this.CA.value) {
            case 0: // TR (transfer)
            case 1: // AD ("add": complement negative numbers)
                if (!this.C1.value || this.drum.L2 == 0) {      // SP operation or even word
                    if (word & Util.absWordMask) {
                        this.CQ.value = 1;
                    }
                } else {                                        // DP odd word
                    if (word) {
                        this.CQ.value = 1;
                    }
                }
                break;
            case 2: // TVA (transfer via AR) or AV (absolute value)
                if (this.S.value < regAR) {
                    if (!this.C1.value || this.drum.L2 == 0) {  // SP operation or even word
                        if (this.drum.read(regAR) & Util.absWordMask) {
                            this.CQ.value = 1;
                        }
                        this.drum.write(regAR, word);
                    } else {                                    // DP odd word
                        if (this.drum.read(regAR)) {
                            this.CQ.value = 1;
                        }
                        this.drum.write(regAR, word);
                    }
                } else {
                    if (!this.C1.value || this.drum.L2 == 0) {  // SP operation or even word
                        if (word & Util.absWordMask) {
                            this.CQ.value = 1;
                        }
                    } else {                                    // DP odd word
                        if (word) {
                            this.CQ.value = 1;
                        }
                    }
                }
                break;
            case 3: // SU ("subtract": change sign)
                if (this.S.value < regAR) {
                    if (!this.C1.value || this.drum.L2 == 0) {  // SP operation or even word
                        if (this.drum.read(regAR) & Util.absWordMask) {
                            this.CQ.value = 1;
                        }
                        this.drum.write(regAR, this.complementSingle(word ^ 1));    // change sign bit
                    } else {
                        if (this.drum.read(regAR)) {
                            this.CQ.value = 1;
                        }
                        this.drum.write(regAR, this.complementDoubleOdd(word));
                    }
                } else {
                    if (!this.C1.value || this.drum.L2 == 0) {  // SP operation or even word
                        if (word & Util.absWordMask) {
                            this.CQ.value = 1;
                        }
                    } else {                                    // DP odd word
                        if (word) {
                            this.CQ.value = 1;
                        }
                    }
                }
                break;
            } // switch this.CA
        });
    }

    /**************************************/
    transferToID() {
        /* Executes a transfer from any source to the ID register (D=25) */

        this.transferDriver(() => {
            let word = 0;

            switch (this.CA.value) {
            case 0: // TR
                word = this.readSource();
                this.drum.write(regPN, 0);     // clear this half of PN
                switch (this.S.value) {
                case 24:    // MQ
                case 25:    // ID
                case 26:    // PN
                    if (!this.C1.value || this.drum.L2 == 0) {
                        this.drum.write(regID, word & Util.absWordMask);
                    } else {
                        this.drum.write(regID, word);
                    }
                    break;
                default:    // S = 0..23 or 27..31
                    if (!this.C1.value || this.drum.L2 == 0) {
                        this.IP.value = word & 1;       // copy this sign bit
                        this.drum.write(regID, word & Util.absWordMask);
                    } else {
                        this.drum.write(regID, word);
                    }
                    break;
                } // switch this.S
                break;

            case 2: // TVA
                word = this.readSource();
                this.drum.write(regPN, 0);     // clear this half of PN
                switch (this.S.value) {
                case 24:    // MQ
                case 25:    // ID
                case 26:    // PN
                    if (this.drum.L2 == 0) {    // even word time
                        this.drum.write(regID, 0);                 // clear ID-0
                        this.drum.write(regAR, word & Util.absWordMask);
                    } else {
                        this.drum.write(regID, this.drum.read(regAR));// copy AR to ID-1
                        if (this.C1.value) {                    // double-precision
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
                    if (!this.C1.value || this.drum.L2 == 0) {
                        this.drum.write(regID, word & Util.absWordMask);
                    } else {
                        this.drum.write(regID, word);
                    }
                    break;
                default:    // S = 0..23 or 27
                    this.drum.write(regPN, 0);     // clear this half of PN
                    if (this.drum.L2 == 0) {    // even word time
                        this.drum.write(regID, 0);                 // clear ID-0
                        this.drum.write(regAR, word & Util.absWordMask);
                        this.IP.value = word & 1;
                    } else {
                        this.drum.write(regID, this.drum.read(regAR));// copy AR to ID-1
                        if (this.C1.value) {                    // double-precision
                            this.drum.write(regAR, word);
                        } else {
                            this.drum.write(regAR, word & Util.absWordMask);
                            this.IP.value = word & 1;
                        }
                    }
                    break;
                } // switch this.S
                break;

            default:    // odd characteristics work as if for a normal line
                this.transferNormal();
                break;
            } // switch this.CA
        });
    }

    /**************************************/
    transferToMQPN(dest) {
        /* Executes a transfer from any source to the MQ or PN registers (D=24,
        26, respectively). There are some slight differences between D=24 and
        D=26 when copying two-word registers with characteristic=0 */

        this.transferDriver(() => {
            let word = 0;

            switch (this.CA.value) {
            case 0: // TR
                word = this.readSource();
                switch (this.S.value) {
                case 24:    // MQ
                case 25:    // ID
                    if (!this.C1.value || this.drum.L2 == 0) {
                        this.drum.write(dest, word & Util.absWordMask);
                    } else {
                        this.drum.write(dest, word);
                    }
                    break;
                case 26:    // PN
                    if (dest == regPN) {        // PN -> PN
                        if (!this.C1.value || this.drum.L2 == 0) {
                            word = (word & Util.absWordMask) | this.IP.value;
                            this.drum.write(dest, this.complementSingle(word));
                        } else {
                            this.drum.write(dest, this.complementDoubleOdd(word));
                        }
                    } else {                    // PN -> MQ works like ID/MQ -> MQ
                        if (!this.C1.value || this.drum.L2 == 0) {
                            this.drum.write(dest, word & Util.absWordMask);
                        } else {
                            this.drum.write(dest, word);
                        }
                    }
                    break;
                default:    // S = 0..23 or 27..31
                    if (!this.C1.value || this.drum.L2 == 0) {
                        this.drum.write(dest, word & Util.absWordMask);
                        if (word & 1) {
                            this.IP.flip();     // reverse IP if word is negative
                        }
                    } else {
                        this.drum.write(dest, word);
                    }
                    break;
                } // switch this.S
                break;

            case 2: // TVA
                word = this.readSource();
                switch (this.S.value) {
                case 24:    // MQ
                case 25:    // ID
                case 26:    // PN
                    if (this.drum.L2 == 0) {    // even word time
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
                    break;
                case 28:    // AR
                case 29:    // 20.IR
                case 30:    // 20/.21
                case 31:    // 20.21
                    if (!this.C1.value || this.drum.L2 == 0) {
                        this.drum.write(dest, word & Util.absWordMask);
                    } else {
                        this.drum.write(dest, word);
                    }
                    break;
                default:    // S = 0..23 or 27
                    if (this.drum.L2 == 0) {    // even word time
                        this.drum.write(dest, 0);               // clear even side of dest
                        this.drum.write(regAR, word & Util.absWordMask);
                        if (word & 1) {
                            this.IP.flip();     // reverse IP is word is negative
                        }
                    } else {
                        this.drum.write(dest, this.drum.read(regAR)); // copy AR to dest-odd
                        if (this.C1.value) {                    // double-precision
                            this.drum.write(regAR, word);
                        } else {
                            this.drum.write(regAR, word & Util.absWordMask);
                            if (word & 1) {
                                this.IP.flip();     // reverse IP is word is negative
                            }
                        }
                    }
                    break;
                } // switch this.S
                break;

            default:    // odd characteristics work as if for a normal line
                this.transferNormal();
                break;
            } // switch this.CA
        });
    }

    /**************************************/
    transferToAR() {
        /* Executes a transfer from any source to the AR register (D=28). Note
        that for D=28, "via AR" operations are not supported, and instead
        characteristics 2 & 3 perform absolute value and negation, respectively */

        this.transferDriver(() => {
            let word = this.readSource();

            switch (this.CA.value) {
            case 0: // TR
                this.drum.write(regAR, word);
                break;
            case 1: // AD
                if (!this.C1.value || this.drum.L2 == 0) {      // SP operation or even word
                    this.drum.write(regAR, this.complementSingle(word));
                } else {                // DP odd word
                    this.drum.write(regAR, this.complementDoubleOdd(word));
                }
                break;
            case 2: // AV
                this.drum.write(regAR, word & Util.absWordMask);
                break;
            case 3: // SU
                if (!this.C1.value || this.drum.L2 == 0) {      // SP operation or even word
                    this.drum.write(regAR, this.complementSingle(word ^ 1)); // change sign bit
                } else {                // DP odd word
                    this.drum.write(regAR, this.complementDoubleOdd(word));
                }
                break;
            } // switch this.CA
        });
    }

    /**************************************/
    addToAR() {
        /* Executes an addition from any source to the AR register (D=29) */

        let addSingle = (a, b) => {
            /* Adds two signed, single-precision words. Assumes negative numbers
            have been converted to complement form. Sets the overflow indicator
            if the signs of the operands are the same and the sign of the sum
            does not match. Returns the sum */
            let aSign = a & 1;          // sign of a
            let aMag = a >> 1;          // 2s complement magnitude of a
            let bSign = b & 1;          // sign of b
            let bMag = b >> 1;          // 2s complement magniturde of b

            // Put the signs in their 2s-complement place and develop the raw sum.
            let sum = (aMag | (aSign << 28)) + (bMag | (bSign << 28));
            let sumSign = (sum >> 28) & 1;

            // Check for overflow
            if (aSign == bSign && aSign != sumSign) {
                this.FO.value = 1;
            }

            // Put the sum back intp G-15 complement format and return it
            return ((sum << 1) & Util.wordMask) | sumSign;
        }

        this.transferDriver(() => {
            let a = this.drum.read(regAR);
            let word = this.readSource();

            switch (this.CA.value) {
            case 0: // TR
                this.drum.write(regAR, addSingle(a, word));
                break;
            case 1: // AD
                if (!this.C1.value || this.drum.L2 == 0) {      // SP operation or even word
                    this.drum.write(regAR, addSingle(a, this.complementSingle(word)));
                } else {                // DP odd word
                    this.drum.write(regAR, addSingle(a, this.complementDoubleOdd(word)));
                }
                break;
            case 2: // AV
                if (!this.C1.value || this.drum.L2 == 0) {   // SP operation or even word
                    this.drum.write(regAR, addSingle(a, word & Util.absWordMask));
                } else {                // DP odd word
                    this.drum.write(regAR, addSingle(a, this.complementDoubleOdd(word)));
                }
                break;
            case 3: // SU
                if (!this.C1.value || this.drum.L2 == 0) {   // SP operation or even word
                    this.drum.write(regAR, addSingle(a, this.complementSingle(word ^ 1))); // change sign bit
                } else {                // DP odd word
                    this.drum.write(regAR, addSingle(a, this.complementDoubleOdd(word)));
                }
                break;
            } // switch this.CA
        });
    }

    /**************************************/
    addToPN() {
        /* Executes an addition from any source to the PN register (D=30) */
        let aSign = 0;                  // sign of augend (PN)
        let bSign = 0;                  // sign of addend (source word)
        let carry = 0;                  // carry bit from even word to odd word
        let pn = 0;                     // local copy of current PN
        let pnSign = 0;                 // final sign to be applied to PN
        let rawSign = 0;                // raw sign result from even word addition

        let addDoubleEven = (a, b) => {
            /* Adds the even word b (representing the source word) of a double-
            precison pair to the even word of a (representing PN-even).
            Assumes negative numbers have been converted to complement form.
            Sets carry from the 30th bit of the raw sum, but does not set the
            overflow indicator. Returns the one-word partial sum */

            aSign = a & 1;              // sign of a (PN)
            bSign = b & 1;              // sign of b (source word)

            // Zero the original signs in the words and develop the raw sum, carry, and sign.
            let sum = (a & Util.absWordMask) + (b & Util.absWordMask);
            carry = (sum >> 29) & 1;    // carry into the odd word
            rawSign = aSign ^ bSign;    // add the signs without carry for use in the odd word

            // Put the sum back into G-15 sign format (absolute value) and return it.
            return sum & Util.wordMask;
        }

        let addDoubleOdd = (a, b) => {
            /* Adds the odd word b (representing the source word) of a double-
            precision pair to the odd word a (representing PN-odd). Assumes
            negative numbers have been converted to complement form. Sets the
            overflow indicator if the signs of the operands are the same and
            the sign of the sum does not match. Computes the final sign and
            returns the sum */

            // Put the raw sign in its 2s-complement place and develop the raw sum.
            let sum = (a | (rawSign << 29)) + b + carry;
            let pnSign = (sum >> 29) & 1;

            // Check for overflow -- if the signs are the same, then rawSign=0.
            if (!rawSign && aSign != pnSign) {
                this.FO.value = 1;
            }

            // Return the sum
            return sum & Util.wordMask;
        }

        this.transferDriver(() => {
            let isEven = (this.drum.L2 == 0);   // at even word
            let p = this.drum.read(regPN);
            let word = this.readSource();

            if (isEven) {               // establish current PN sign
                p = (p & Util.absWordMask) | pnSign;
            }

            switch (this.CA.value) {
            case 0: // TR
                if (!this.C1.value || isEven) {
                    p = addDoubleEven(p, word);
                } else {
                    p = addDoubleOdd(p, word);
                }
                break;
            case 1: // AD
                if (!this.C1.value || isEven) {
                    p = addDoubleEven(p, this.complementSingle(word));
                } else {
                    p = addDoubleOdd(p, this.complementDoubleOdd(word));
                }
                break;
            case 2: // AV               // since it's absolute value, no complementing is necessary
                if (!this.C1.value || isEven) {
                    p = addDoubleEven(p, word & Util.absWordMask);
                } else {
                    p = addDoubleOdd(p, word);
                }
                break;
            case 3: // SU
                if (!this.C1.value || isEven) {
                    p = addDoubleEven(p, this.complementSingle(word ^ 1)); // change sign bit
                } else {
                    p = addDoubleEven(p, this.complementDoubleOdd(word));
                }
                break;
            } // switch this.CA

            this.drum.write(regPN, p);
        });

        // Finally, apply the final sign of the addition to the even word of PN
        this.drum.setPNSign(pnSign);
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
                this.ioInputBitCount += 4;
            } else {
                switch(code & 0b00111) {
                case IOCodes.ioCodeMinus:       // minus: set sign FF
                    this.OS.value = 1;
                    break;
                case IOCodes.ioCodeCR:          // carriage return: shift sign into word
                case IOCodes.ioCodeTab:         // tab: shift sign into word
                    await this.drum.ioPrecessCodeTo23(this.OS.value, 1);
                    this.OS.value = 0;
                    ++this.ioInputBitCount;
                    break;
                case IOCodes.ioCodeStop:        // end/stop
                    eob = true;
                    // no break: Stop implies Reload
                case IOCodes.ioCodeReload:      // reload
                    await this.drum.ioCopy23ToMZ();
                    await this.drum.ioPrecessMZTo19();
                    this.ioInputBitCount = 0;
                    break;
                case IOCodes.ioCodePeriod:      // period: ignored
                    break;
                case IOCodes.ioCodeWait:        // wait: insert a 0 digit on input
                    await this.drum.ioPrecessCodeTo23(0, 4);
                    this.ioInputBitCount += 4;
                    break;
                default:                        // treat everything else as space & ignore
                    break;
                }
            }

            // Check if automatic reload is enabled
            if (this.AS.value && this.ioInputBitCount >= Util.fastLineSize*Util.wordBits) {
                await this.drum.ioCopy23ToMZ();
                await this.drum.ioPrecessMZTo19();
                this.ioInputBitCount = 0;
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

        switch (-code) {
        case 0x41: case 0x61:           // A - Type out AR
            this.violation("Enable-A type out AR not implemented");
            break;
        case 0x42: case 0x62:           // B - Back up photo tape one block
            await this.reversePhotoTapePhase1();
            break;
        case 0x43: case 0x63:           // C - Select command line
            this.setCommandLine(0);
            break;
        case 0x46: case 0x66:           // F - Set first word of command line
            this.stop();
            this.drum.waitUntil(0);
            this.drum.throttle();
            this.N.value = 0;
            this.drum.CM.value &= Util.wordMask & ~0b11111_11111_0;     // clear any mark
            break;
        case 0x49: case 0x69:           // I - Initiate single cycle
            this.step();
            break;
        case 0x4D: case 0x6D:           // M - Mark place
            this.drum.waitUntil(107);
            this.drum.throttle();
            this.drum.write(0, this.drum.CM.value ^ Util.wordMask);
            this.drum.write(1, this.drum.read(regAR));
            break;
        case 0x50: case 0x70:           // P - Start photo reader
            this.stop();
            this.drum.waitUntil(0);
            this.drum.throttle();
            this.N.value = 0;
            this.setCommandLine(7);
            await this.readPhotoTape();
            break;
        case 0x51: case 0x71:           // Q - Permit type in
            if (this.OC.value == IOCodes.ioCmdReady) {
                this.OC.value = IOCodes.ioCmdTypeIn;
            }
            break;
        case 0x52: case 0x72:           // R - Return to marked place
            this.drum.waitUntil(107);
            this.drum.throttle();
            this.drum.CM.value = this.drum.read(0) ^ Util.wordMask;
            this.drum.write(regAR, this.drum.read(1));
            break;
        case 0x54: case 0x74:           // T - Copy command location to AR high-order bits
            this.drum.write(regAR, (this.N.value << 21) | ((this.N.value ? 0 : 1) << 28) |
                (this.drum.read(regAR) & 0b0_0000000_1_1111111_11_11111_11111_1));
            break;
        }
    }

    /**************************************/
    async receiveKeyboardCode(code) {
        /* Processes a keyboard code sent from ControlPanel. If the code is
        negative, it is the ASCII code for a control command used with the Enable
        switch. Otherwise it is an I/O data/control code to be processed as
        TYPE IN (D=31, S=12) input . Note that an "S" key can be used for
        both purposes depending on the state of this.enableSwitch */

        if (code < 0) {
            // Control command.
            if (this.enableSwitch) {
                await this.executeKeyboardCommand(code);
            }
        } else if (this.OC.value == IOCodes.ioCmdTypeIn) {
            // Input during TYPE IN.
            await this.receiveInputCode(code);
            if (code == IOCodes.ioCodeStop) {
                this.finishIO();
            }
        } else if (this.enableSwitch) {
            // A data key with Enable but not during TYPE IN.
            switch (code) {
            case 0b10000:               // 0
            case 0b10001:               // 1
            case 0b10010:               // 2
            case 0b10011:               // 3
            case 0b10100:               // 4
            case 0b10101:               // 5
            case 0b10110:               // 6
            case 0b10111:               // 7
                this.setCommandLine(this.CD.value | (code & 0b00111));
                break;
            case IOCodes.ioCodeStop:    // S
                this.cancelIO();
                break;
            }
        }
    }

    /**************************************/
    async formatOutputCharacter(fmt) {
        /* Generates the necessary output for one format code, fmt, returning
        the code to be output to the device */
        let code = 0;

        switch (fmt) {
        case 0b000:     // digit
            {
            let pair = await this.drum.ioPrecess19ToCode(4);
            code = pair[0] | 0b10000;
            this.OS.value = pair[1];
            }
            break;
        case 0b001:     // end/stop
            if (await this.drum.ioTest19Zero()) {
                code = IOCodes.ioCodeStop;
            } else {
                code = IOCodes.ioCodeReload;
            }
            break;
        case 0b010:     // carriage return - precess and discard the sign bit
            await this.drum.ioPrecess19ToCode(1);
            code = IOCodes.ioCodeCR;
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
            await this.drum.ioPrecess19ToCode(1);
            code = IOCodes.ioCodeTab;
            break;
        case 0b111:     // wait - precess and discard the digit
            this.OS.value = (await this.drum.ioPrecess19ToCode(4))[1];
            code = IOCodes.ioCodeWait;
            break;
        }

        return code;
    }

    /**************************************/
    async punchLine19() {
        /* Punches the contents of line 19, starting with the four high-order
        bits of of word 107, and precessing the line with each character until
        the line is all zeroes */
        const punchPeriod = Util.drumCycleTime*2;
        let code = 0;                   // output character code
        let punching = true;            // true until STOP or I/O cancel
        let fmt = 0;                    // format code

        this.OC.value = IOCodes.ioCmdPunch19;
        this.activeIODevice = this.devices.photoTapeReader;
        this.drum.ioStartTiming();
        let outTime = this.drum.ioTime + punchPeriod;

        // Output an initial SPACE code (a quirk of the Slow-Out logic)
        await this.devices.photoTapePunch.write(IOCodes.ioCodeSpace);
        await this.ioTimer.delayUntil(outTime);
        outTime += punchPeriod;

        // Start a MZ reload cycle.
        do {
            fmt = await this.drum.ioPrecessLongLineToMZ(2);

            // The character cycle.
            do {
                if (this.OC.value != IOCodes.ioCmdPunch19) {
                    punching = false;   // I/O canceled
                } else {
                    code = await this.formatOutputCharacter(fmt);
                    if (code == IOCodes.ioCodeStop) {
                        punching = false;
                    }

                    this.devices.photoTapePunch.write(code);    // no await
                    await this.ioTimer.delayUntil(outTime);
                    outTime += punchPeriod;
                }
            } while (code != IOCodes.ioCodeReload && punching);
        } while (punching);

        this.finishIO();
    }

    /**************************************/
    async readPhotoTape() {
        /* Reads one block from the Photo Tape Reader to line 19 via line 23 */

        this.OC.value = IOCodes.ioCmdPhotoRead;
        this.activeIODevice = this.devices.photoTapeReader;
        await this.devices.photoTapeReader.read();
        this.finishIO();
    }

    /**************************************/
    async reversePhotoTapePhase1() {
        /* Performs Phase 1 of photo tape search reverse, then performs Phase 2.
        The result is to leave the tape positioned to the prior block */

        this.OC.value = IOCodes.ioCmdPhotoRev1;
        await this.devices.photoTapeReader.reverseBlock();
        if (this.OC.value == IOCodes.ioCmdPhotoRev1) {  // check for cancel
            await this.reversePhotoTapePhase2();
        }

        this.finishIO();
    }

    /**************************************/
    async reversePhotoTapePhase2() {
        /* Performs Phase 1 of photo tape search reverse, then performs Phase 2.
        The result is to leave the tape positioned to the prior block. Note that
        the forward read will at least partially overwrite lines 23 and 19 */

        this.OC.value = IOCodes.ioCmdPhotoRev2;
        await this.devices.photoTapeReader.reverseBlock();
        if (this.OC.value == IOCodes.ioCmdPhotoRev2) {  // check for cancel
            await this.devices.photoTapeReader.read();
        }

        this.finishIO();
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
        this.ioInputBitCount = 0;
        this.activeIODevice = null;
    }

    /**************************************/
    initiateIO(sCode) {
        /* Initiates the I/O operation specified by sCode */

        if (this.OC.value != IOCodes.ioCmdReady) {
            if (sCode == 0) {
                this.cancelIO();
            } else {
                this.violation(`initiateIO with I/O active: D=31 S=${sCode} not implemented`);
            }

            this.drum.waitUntil(this.T.value);
            return;                     // unless it's a cancel, ignore this request
        }

        if (this.C1.value) {
            this.AS.value = 1;          // set automatic line 23 reload (alphanumeric systems)
        }

        switch (sCode) {
        case IOCodes.ioCmdCancel:
            this.cancelIO();
            break;

        case IOCodes.ioCmdMTWrite:      // magnetic tape write
            this.violation(`D=31 S=${sCode} not implemented`);
            this.cancelIO();
            break;

        case IOCodes.ioCmdPunchLeader:  // fast punch leader, etc.
            this.violation(`D=31 S=${sCode} not implemented`);
            this.cancelIO();
            break;

        case IOCodes.ioCmdFastPunch:    // fast punch line 19, etc.
            this.violation(`D=31 S=${sCode} not implemented`);
            this.cancelIO();
            break;

        case IOCodes.ioCmdMTSearchRev:  // magnetic tape search, reverse
            this.violation(`D=31 S=${sCode} not implemented`);
            this.cancelIO();
            break;

        case IOCodes.ioCmdMTSearchFwd:  // magnetic tape search, forward
            this.violation(`D=31 S=${sCode} not implemented`);
            this.cancelIO();
            break;

        case IOCodes.ioCmdPhotoRev1:    // photo tape reverse, phase 1
            this.reversePhotoTapePhase1();
            break;

        case IOCodes.ioCmdPhotoRev2:    // photo tape reverse, phase 2
            this.reversePhotoTapePhase2();
            break;

        case IOCodes.ioCmdTypeAR:       // type AR
            this.violation(`D=31 S=${sCode} not implemented`);
            this.cancelIO();
            break;

        case IOCodes.ioCmdType19:       // type line 19
            this.violation(`D=31 S=${sCode} not implemented`);
            this.cancelIO();
            break;

        case IOCodes.ioCmdPunch19:      // paper tape punch line 19
            this.punchLine19();
            break;

        case IOCodes.ioCmdCardPunch19:  // card punch line 19
            this.punchLine19();
            break;

        case IOCodes.ioCmdTypeIn:       // type in
            this.violation(`D=31 S=${sCode} not implemented`);
            this.cancelIO();
            break;

        case IOCodes.ioCmdMTRead:       // magnetic tape read
            this.violation(`D=31 S=${sCode} not implemented`);
            this.cancelIO();
            break;

        case IOCodes.ioCmdCardRead:     // card read, etc.
            this.violation(`D=31 S=${sCode} not implemented`);
            this.cancelIO();
            break;

        case IOCodes.ioCmdPhotoRead:    // photo tape read
            this.readPhotoTape();
            break;

        default:
            this.violation(`D=31 S=${sCode} not implemented`);
            break;
        }

        this.transferDriver(this.transferNothing);

    }


    /*******************************************************************
    *  Special (D=31) Commands                                         *
    *******************************************************************/

    /**************************************/
    markReturn() {
        /* Handles the messy details of D=31, S=20, Select Command Line and
        Return Exit. See G-15 Technical Applications Memorandum 4 and 41 */
        let loc = this.drum.L.value;
        let n = this.N.value;
        let mark = (this.drum.CM.value & 0b11_11111_11111_0) >> 1;
        let t = this.T.value;

        this.setCommandLine((this.C1.value << 2) | this.CA.value);

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

        this.transferDriver(this.transferNothing);
    }

    /**************************************/
    specialCommand() {
        /* Executes a special command for D=31. The specific command is
        determined by the source (S=0-31) and characteristic */

        switch(this.S.value) {
        case 16:        // halt
            this.CH.value = 1;
            this.transferDriver(this.transferNothing);
            break;

        case 17:        // ring bell & friends
            this.panel.ringBell((this.T.value - this.drum.L.value + Util.longLineSize) % Util.longLineSize);
            switch (this.CA.value ) {
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
            this.transferDriver(this.transferNothing);
            break;

        case 18:        // transfer M20.ID to output register
            this.transferDriver(() => {
                this.OR.value = this.drum.read(20) & this.drum.read(regID);
            });
            break;

        case 19:        // start/stop DA-1
            // this.violation(`D=31 S=${this.S.value} DA-1 not implemented`);
            this.transferDriver(this.transferNothing);
            break;

        case 20:        // select command line & return exit
            this.markReturn();
            break;

        case 21:        // select command line & mark exit
            this.setCommandLine((this.C1.value << 2) | this.CA.value);
            // Set the mark in T2-T13 of CM. This command takes only one word
            // time regardless of this.C1, so don't use this.transferDriver().
            this.drum.CM.value = (this.drum.L.value << 1) |
                    (this.drum.CM.value & 0b1_1111111_1_1111111_00_00000_00000_1);
            this.drum.waitFor(1);
            break;

        case 22:        // sign of AR to TEST
            if (this.drum.read(regAR) & 1) {
                this.CQ.value = 1;
            }
            this.transferDriver(this.transferNothing);
            break;

        case 23:        // clear MQ/ID/PN/IP, etc.
            switch (this.CA.value) {
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
                    this.drum.write(regID, this.drum.read(regPN) & this.drum.read(2));
                    this.drum.write(regPN, this.drum.read(regPN) & (~this.drum.read(2)));
                });
                break;
            }
            break;

        case 24:        // multiply
            this.violation(`D=31 S=${this.S.value} not implemented`);
            this.transferDriver(this.transferNothing);
            break;

        case 25:        // divide
            this.violation(`D=31 S=${this.S.value} not implemented`);
            this.transferDriver(this.transferNothing);
            break;

        case 26:        // shift MQ left and ID right
            this.violation(`D=31 S=${this.S.value} not implemented`);
            this.transferDriver(this.transferNothing);
            break;

        case 27:        // normalize MQ
            this.violation(`D=31 S=${this.S.value} not implemented`);
            this.transferDriver(this.transferNothing);
            break;

        case 28:        // ready, etc. to TEST
            switch (this.CA.value) {
            case 0:                     // test I/O subsystem ready
                this.transferDriver(() => {
                    if (this.OC.value == IOCodes.ioCmdReady) {
                        this.CQ.value = 1;
                    }
                });
                break;
            case 1:                     // test Input Register ready
                this.transferDriver(this.transferNothing);      // IR not implemented
                break;
            case 2:                     // test Output Register ready
                this.transferDriver(this.transferNothing);      // OR not implemented
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
            this.transferDriver(this.transferNothing);
            break;

        case 30:        // magnetic tape write file code
            this.violation(`D=31 S=${this.S.value} not implemented`);
            this.transferDriver(this.transferNothing);
            break;

        case 31:        // odds & sods
            switch (this.CA.value) {
            case 0:                     // next command from N+1
                this.CG.value = 1;
                this.transferDriver(this.transferNothing);
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
            this.cmdLoc.value = 127;
            cmd = this.drum.read(regAR);
            this.CG.value = 0;
        } else {                        // next command from one of the CD lines
            this.cmdLoc.value = loc;
            cmd = this.drum.read(this.cmdLine);
        }

        this.C1.value = cmd & 0x01;             // single/double mode
        this.D.value =  (cmd >> 1) & 0x1F;      // destination line
        this.S.value =  (cmd >> 6) & 0x1F;      // source line
        this.CA.value = (cmd >> 11) & 0x1F;     // characteristic code
        this.N.value =  (cmd >> 13) & 0x7F;     // next command location
        this.BP.value = (cmd >> 20) & 0x01;     // breakpoint flag
        this.T.value =  (cmd >> 21) & 0x7F;     // operand timing number
        this.DI.value = (cmd >> 28) & 0x01;     // immediate/deferred execution bit

        // Set "via AR" flip-flop (CX . S7/ . D7/) - for display only
        this.CS.value = (((cmd >> 12) & 1) && (~(cmd >> 8) & 7) && (~(cmd >> 3) & 7) ? 1 : 0);

        // Officially, L=107 is disqualified as a location for a command. The
        // reason is that location arithmetic is done using a 7-bit number (with
        // values 0-127) but the location following 107 is 0, not 108. The number
        // track (CN) normally handles this by increasing the N and (usually) T
        // numbers by 20 when passing location 107 to turn location 108 into
        // location 128, which in a 7-bit register is the same as zero. Alas,
        // this adjustment does not occur when a command is executed from
        // location 107, so N and (usually) T in the command will behave as if
        // they are 20 word-times too low. The following code adjusts T and N
        // so that they will behave as the hardware would have.

        if (loc == 127) {
            this.violation("Execute command from L=107");
            this.N.value = (this.N.value - 20 + Util.longLineSize) % Util.longLineSize;
            if (this.D.value == 31 && (this.S.value & 0b11100) != 0b11000) {    // not 24-27: MUL, DIV, SHIFT, NORM
                this.T.value = (this.N.value - 20 + Util.longLineSize) % Util.longLineSize;
            }
        }

        // Complement T and N in CM (for display purposes only)
        this.drum.CM.value = cmd ^ 0b0_1111111_0_1111111_00_00000_00000_0;

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
            break;
        case 24:
            this.transferToMQPN(regMQ);
            break;
        case 25:
            this.transferToID();
            break;
        case 26:
            this.transfertoMQPN(regPN)
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
        current slice time limit, in which case it delays until real time catches
        up to emulation time. We continue to run until the a halt condition is
        detected */

        do {                            // run until halted
            if (this.RC.value) {        // enter READ COMMAND state
                this.readCommand();
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
                if (this.tracing) {
                    this.traceState();  // DEBUG ONLY
                }
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
                this.devices.photoTapeReader.rewind();
                break;
            }
        }
    }

    /**************************************/
    async systemReset() {
        /* Resets the system and initiates loading paper tape. Activated from
        the ControlPanel RESET button */

        if (this.poweredOn && this.CH.value) {
            this.CZ.value = 1;          // enable read-command state (i.e., disable stepping)
            this.RC.value = 1;          // set read-command state
            this.TR.value = 0;          // reset transfer state
            this.CG.value = 0;          // reset Next-From-AR FF
            this.CQ.value = 0;          // reset TEST FF
            this.OC.value = IOCodes.ioCmdReady;

            // Load the Number Track, CN
            this.drum.startTiming();
            await this.readPhotoTape();         // number track data to line 19
            this.drum.waitUntil(0);
            for (let x=0; x<Util.longLineSize; ++x) {
                this.drum.writeCN(this.drum.read(19));
                this.drum.waitFor(1);
            }

            // Load the next block from paper tape
            this.setCommandLine(7);             // execute code from line 23
            this.N.value = 0;
            await this.readPhotoTape();         // read a bootstrap loader
        }
    }

    /**************************************/
    powerUp() {
        /* Powers up and initializes the processor */

        if (!this.poweredOn) {
            this.poweredOn = true;
            this.CH.value = 1;          // set HALT FF
            this.panel = this.context.controlPanel;     // ControlPanel object
            this.devices = this.context.devices;        // I/O device objects
            this.loadMemory();          // DEBUG ONLY
        }
    }

    /**************************************/
    powerDown() {
        /* Powers down the processor */

        this.stop();
        this.poweredOn = false;
    }

    /**************************************/
    loadMemory() {
        /* Loads debugging code into the drum memory */

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

        int(0, 90, 0);
        int(0, 91, 1);
        int(0, 92, 2);
        int(0, 95, 0xFFFFFFF);
        int(0, 96, -0xFFFFFFF);

        //  M   L  DI   T    N  CA  S   D  C1  BP
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
        asm(0, 11, 0,  12,  12, 0, 17, 31);             // ring bell
        //asm(0, 12, 0,  14,  11, 0, 16, 31);             // halt, then go to ring bell

        asm(0, 12, 0,  14,  13, 0, 16, 31);             // halt
        asm(0, 13, 0,  15,  14, 0, 10, 31);             // punch line 19
        asm(0, 14, 0,  16,  14, 0, 16, 31);             // loop on halt
    }

} // class Processor


// Static class properties

Processor.CDXlate = [0, 1, 2, 3, 4, 5, 19, 23];         // translate CD register to drum line numbers
