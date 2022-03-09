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

const regMQ = 24;                          // MQ register drum line
const regID = 25;                          // ID register drum line
const regPN = 26;                          // PN register drum line
const regAR = 28;                          // AR register drum line


class Processor {

    constructor() {
        /* Constructor for the G-15 processor object */

        this.drum = new Drum();                         // the drum memory
        this.panel = null;                              // set from G15.js after initialization

        // Flip-flops
        this.AS = new FlipFlop(this.drum, false);       // Automatic/Standard PPT reload FF (AN models only)
        this.BP = new FlipFlop(this.drum, false);       // breakpoint bit in command
        this.C1 = new FlipFlop(this.drum, false);       // single/double bit in command
        this.CG = new FlipFlop(this.drum, false);       // next command from AR FF
        this.CH = new FlipFlop(this.drum, false);       // HALT FF
        this.CJ = new FlipFlop(this.drum, false);       // initiate read command-state (CH/ . CZ)
        this.CQ = new FlipFlop(this.drum, false);       // TEST false FF (=> N = N+1)
        this.CS = new FlipFlop(this.drum, false);       // "via AR" characteristic FF
        this.CZ = new FlipFlop(this.drum, false);       // read-command-state enabled
        this.DI = new FlipFlop(this.drum, false);       // immediate/deferred execution bit in command
        this.FO = new FlipFlop(this.drum, false);       // overflow FF
        this.IP = new FlipFlop(this.drum, false);       // sign FF for 2-word registers
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
        this.poweredOn = false;                         // powered up and ready to run
        this.tracing = false;                           // trace command debugging

        // UI switch state
        this.computeSwitch = 0;                         // 0=OFF, 1=GO, 2=BP
        this.enableSwitch = 0;                          // 0=normal, 1=enable typewriter keyboard
        this.punchSwitch = 0;                           // 0=off, 1=copy to paper-tape punch
        this.violationHaltSwitch = 0;                   // halt on standard-command violation
    }

    /**************************************/
    set controlPanel(panel) {
        this.panel = panel;
    }

    /**************************************/
    traceState() {
        // Eventually log current state to the console
    }

    /**************************************/
    violation(msg) {
        /* Posts a violation of standard-command usage */

        this.VV.value = 1;
        console.warn(">VIOLATION: %s cmd@%d.%d DI=%d T=%d BP=%d N=%d CH=%d S=%d D=%d C1=%d",
                msg, this.cmdLine, this.cmdLoc.value, this.DI.value, this.T.value, this.BP.value,
                this.N.value, this.CA.value, this.S.value, this.D.value, this.C1.value);
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

    /**************************************/
    specialCommand() {
        /* Executes a special command for D=31. The specific command is
        determined by the source (S=0-31) and characteristic */

        switch(this.S.value) {
        case 16:        // halt
            this.CH.value = 1;
            this.drum.waitUntil(this.T.value);
            break;
        case 17:        // ring bell & friends
            let wordTimes = this.T.value - this.drum.L.value;
            if (wordTimes <= 0) {
                wordTimes += Util.longLineSize;
            }

            this.panel.ringBell(wordTimes);
            switch (this.CA.value) {
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
            this.drum.waitUntil(this.T.value);
            break;
        case 22:        // sign of AR to TEST
            if (this.drum.read(regAR) & 1) {
                this.CQ.value = 1;
            }
            this.drum.waitUntil(this.T.value);
            break;
        case 29:        // test for overflow
            if (this.FO.value) {
                this.CQ.value = 1;      // next command from N+1
                this.FO.value = 0;      // test resets overflow condition
            }
            this.drum.waitUntil(this.T.value);
            break;
        case 31:        // odds & sods
            switch (this.CA.value) {
            case 0:                     // next command from N+1
                this.CG.value = 1;
                this.drum.waitUntil(this.T.value);
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
            this.violation(`D=31 S={this.S.value} not implemented`);
            this.drum.waitUntil(this.T.value);
            break;
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

    /**************************************/
    async run() {
        /* Main execution control loop for the processor. Attempts to throttle
        performance to approximate that of a real G-15. The drum manages the
        system timing, updating its L and eTime properties as calls on its
        waitFor() and waitUntil() methods are made. Once eTime exceeds the
        current slice time limit, we call the drum's throttle() async method
        to delay until real time catches up to emulation time. We continue to
        run time slices until the a halt condition is detected */

        do {                                    // run until halted

            do {                                // run a time slice
                if (this.RC.value) {            // enter READ COMMAND state
                    this.readCommand();
                    if (this.computeSwitch == 2 && this.BP.value) {
                        this.stop();
                        break;                  // exit loop due to breakpoint
                    }
                } else if (this.TR.value) {     // enter TRANSFER (execute) state
                    this.transfer();
                    if (this.tracing) {
                        this.traceState();      // DEBUG ONLY
                    }

                    if (this.drum.eTime > this.drum.eTimeSliceEnd) {
                        break;
                    } else if (this.CH.value) { // we've been halted
                        break;
                    }
                } else {
                    this.violation("State neither RC nor TR");
                }
            } while (true);

            // If we're halted, just exit; otherwise do throttling and then continue
            if (this.CH.value) {
                break;
            } else {
                await this.drum.throttle();
            }
        } while (true);

        this.updateLampGlow(1);
    }

    /**************************************/
    start() {
        /* Initiates the processor on the Javascript thread */

        if (this.poweredOn && this.CH.value) {
            this.CH.value = 0;          // reset HALT FF
            this.TR.value = 0;          // reset transfer state
            this.RC.value = 1;          // set read-command state
            this.drum.startTiming();
            this.run();                 // async -- returns immediately
        }
    }

    /**************************************/
    stop() {
        /* Stops running the processor on the Javascript thread */

        if (this.poweredOn && !this.CH.value) {
            this.CH.value = 1;          // set HALT FF
            this.TR.value = 0;          // reset transfer and read-command states
            this.RC.value = 0;
        }
    }

    /**************************************/
    step() {
        /* Single-steps the processor. This will execute the next command
        only, then stop the processor. Note that this.CH remains set during
        the step execution */

        if (this.poweredOn && this.CH.value) {
            this.TR.value = 0;          // reset transfer state
            this.RC.value = 1;          // set read-command state
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
            case 1:
                this.start();
                break;
            case 2:
                if (this.CH.value) {
                    this.start();
                }
                break;
            }
        }
    }

    /**************************************/
        /* Reacts to a change in state of the ControlPanel ENABLE switch */
    enableSwitchChange(state) {

        if (this.enableSwitch != state) {
            this.enableSwitch = state;
        }
    }

    /**************************************/
    punchSwitchChange(state) {
        /* Reacts to a change in state of the ControlPanel PUNCH switch */

        if (this.punchSwitch != state) {
            this.punchSwitch = state;
        }
    }

    /**************************************/
    powerUp() {
        /* Powers up and initializes the processor */

        if (!this.poweredOn) {
            this.CH.value = 1;          // set HALT FF
            this.CQ.value = 0;          // reset TEST FF
            this.poweredOn = true;
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
        asm(0, 12, 0,  14,  11, 0, 16, 31);             // halt, then go to ring bell
    }

} // class Processor


// Static class properties

Processor.CDXlate = [0, 1, 2, 3, 4, 5, 19, 23];         // translate CD register to drum line numbers
