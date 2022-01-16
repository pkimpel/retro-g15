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

import {Drum} from "./Drum.js";
import {FlipFlop} from "./FlipFlop.js";
import {Register} from "./Register.js";

const MQ = 24;                          // MQ register drum line
const ID = 25;                          // ID register drum line
const PN = 26;                          // PN register drum line
const AR = 28;                          // AR register drum line


class Processor {

    constructor() {
        /* Constructor for the G-15 processor object */

        this.drum = new Drum();                         // the drum memory

        // Flip-flops
        this.AS = new FlipFlop(this.drum, true);        // Automatic/Standard PPT reload FF (AN models only)
        this.BP = new FlipFlop(this.drum, true);        // breakpoint bit in command
        this.C1 = new FlipFlop(this.drum, true);        // single/double bit in command
        this.CG = new FlipFlop(this.drum, true);        // next command from AR FF
        this.CH = new FlipFlop(this.drum, true);        // HALT FF
        this.CJ = new FlipFlop(this.drum, true);        // initiate read command-state (CH/ . CZ)
        this.CZ = new FlipFlop(this.drum, true);        // read-command-state enabled
        this.CQ = new FlipFlop(this.drum, true);        // TEST true FF (=> N = N+1)
        this.CS = new FlipFlop(this.drum, true);        // "via AR" characteristic FF
        this.DI = new FlipFlop(this.drum, true);        // immediate/deferred execution bit in command
        this.FO = new FlipFlop(this.drum, true);        // overflow FF
        this.IP = new FlipFlop(this.drum, true);        // sign FF for 2-word registers
        this.RC = new FlipFlop(this.drum, true);        // read-command state FF
        this.SA = new FlipFlop(this.drum, true);        // typewriter enable (safety) switch FF
        this.TR = new FlipFlop(this.drum, true);        // transfer-state FF

        this.VV = new FlipFlop(this.drum, true);        // standard command violation FF

        // Registers
        this.D  = new Register( 5, this.drum, true);    // destination line in command
        this.S  = new Register( 5, this.drum, true);    // source line in command
        this.CA = new Register( 2, this.drum, true);    // characteristic bits in command
        this.CD = new Register( 3, this.drum, true);    // current command-line designator
        this.IR = new Register(29, this.drum, false);   // input register (zero unless external circuit exists)
        this.N  = new Register( 7, this.drum, true);    // next cmd location in command
        this.OC = new Register( 5, this.drum, true);    // I/O operation code register (bit 5 = READY)
        this.OR = new Register(29, this.drum, false);   // output register (a sink unless external circuit exists)
        this.T  = new Register( 7, this.drum, true);    // timing number from command

        // General state
        this.cmdLine = 0;                               // current actual command line (see CDXlate)
        this.cmdLoc = 0;                                // current command word-time
        this.dpCarry = 0;                               // inter-word carry bit for double-precision
        this.evenSign = 0;                              // sign of the even word of a double-precision pair
        this.poweredOn = false;                         // powered up and ready to run
        this.tracing = false;                           // trace command debugging

        this.goSwitch = 0;                              // 0=halt, 1=GO, 2=BP
        this.violationHaltSwitch = 0;                   // halt on standard command violation
    }

    /**************************************/
    violation(msg) {
        /* Posts a violation standard command usage */

        this.VV.value = 1;
        console.warn(">VIOLATION: %s cmd@%d.%d DI=%d T=%d BP=%d N=%d CH=%d S=%d D=%d C1=%d",
                msg, this.cmdLine, this.cmdLoc, this.DI.value, this.T.value, this.BP.value,
                this.N.value, this.CA.value, this.S.value, this.D.value, this.C1.value);
        if (this.violationHaltSwitch) {
            this.stop();
        }
    }

    /**************************************/
    readCommand() {
        /* Reads the next command into the command register (CM) and sets up the
        processor state to execute that command */
        let cmd = 0;                    // command word
        let loc = this.N;               // word-time of command

        if (this.CQ.value) {            // check the result of a prior TEST
            loc = (loc+1) % Drum.longLineSize;
            this.CQ.value = 0;
        }

        this.drum.waitUntil(this.cmdLine, loc);
        if (this.CG.value) {            // next command from AR
            this.cmdLoc = -1;
            cmd = this.drum.read(AR);
            this.CG.value = 0;
        } else {                        // next command from one of the CD lines
            this.cmdLoc = loc;
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

        // Officially, L=107 is disqualified as a location for a command. The
        // reason is that location arithmetic is done using a 7-bit number (with
        // values 0-127) but the location following 107 is 0, not 108. The number
        // track (CN) normally adjusts for this by adjusting the location
        // arithmetic by 20 when passing location 107 to turn location 108 into
        // location 128, which is the same as zero. Alas, this adjustment does
        // not occur when a command is executed from location 107, so both T
        // and N in the command will behave as if they are 20 word-times too low.
        // The following code adjusts T and N so that they will behave as the
        // hardware would have.

        if (loc == 127) {
            this.violation("Execute command from L=107");
            this.N.value = (this.N.value - 20 + Drum.longLineSize) % Drum.longLineSize;
            if (this.D.value == 31 && (this.S.value & 0b11100) != 0b11000) {    // not 24-27: MUL, DIV, SHIFT, NORM
                this.T.value = (this.N.value - 20 + Drum.longLineSize) % Drum.longLineSize;
            }
        }

        this.drum.CM.value = cmd ^ 0b0_1111111_0_1111111_00_00000_00000_0; // complement T and N (for display only)

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
                return ((Processor.two28 - mag) << 1) | sign;
            } else {                    // positive, do not complement
                return word;
            }
        }
    }

    /**************************************/
    complementDoubleOdd(word) {
        /* Converts the second word of a double-precision operand between
        complement forms, returning the converted word. this.dpCarry is assumed
        to hold any carry from complementing the low-order word of the pair. Any
        overflow from complementing the high-order word is discarded */

        if (this.evenSign) {            // even word was negative
            return (Processor.wordMask - word + this.dpCarry) & Processor.wordMask;
        } else {
            return (word + this.dpCarry) & Processor.wordMask;
        }
    }

    /**************************************/
    addSingle(a, b) {
        /* Adds two signed, single-precision words. Assumes negative numbers have
        been converted to complement form. Sets the overflow indicator if the
        signs of the operands are the same and the sign of the sum does not match.
        Returns the sum */
        let aSign = a & 1;              // sign of a
        let aMag = a >> 1;              // 2s complement magnitude of a
        let bSign = b & 1;              // sign of b
        let bMag = b >> 1;              // 2s complement magniturde of b

        // Put the signs in their 2s-complement place and develop the raw sum.
        let sum = (aMag | (aSign << 28)) + (bMag | (bSign << 28));
        let sumSign = (sum >> 28) & 1;

        // Check for overflow
        if (aSign == bSign && aSign != sumSign) {
            this.FO.value = 1;
        }

        // Put the sum back in G-15 complement format and return it
        return ((sum << 1) & Processor.wordMask) | sumSign;
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
                        word = (word & Processor.absWordMask) | this.IP;
                    }
                }
                return word;
            }
            break;
        case 27:        // 20.21 + 20/.AR
            {   let m20 = this.drum.read(20);
                let m21 = this.drum.read(21);
                return (m20 & m21) | (~m20 & this.drum.read(AR));
            }
            break;
        case 28:        // AR
            return this.drum.read(AR);
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
        handles the majority of immediate/deferred and double-precision details */
        let count = 1;                  // defaults to one word time

        if (this.DI.value) {
            // Deferred execution, transfer one or two words at time T.
            this.drum.waitUntil(this.T.value);
            if (this.C1.value && this.drum.L2 == 0) {
                ++count;                // DP operand starts on even word
            }
        } else {
            // Immediate execution, transfer at current word time through T-1.
            count = this.T.value - this.drum.L;
            if (count <= 0) {
                count += Drum.longLineSize;
            }
        }

        if (this.C1 && this.drum.L2 == 1) {
            this.violation("DP transfer on ODD word");
        }

        do {
            transform();
            this.drum.waitFor(1);
        } while (--count > 0);
    }

    /**************************************/
    transferNormal() {
        /* Executes a transfer from any source to lines 0-23. "Via AR" operations
        are not supported for S=28, so special action is taken for those cases */

        this.transferDriver(() => {
            let word = this.readSource();

            switch (this.CA.value) {
            case 0: // TR (transfer)
                this.drum.write(this.D.value, word);
                break;
            case 1: // AD ("add": complement negative numbers)
                if (!this.C1.value) {   // SP operation
                    word = this.complementSingle(word);
                } else {                // DP operation
                    if (this.drum.L2 == 0) {    // even word of DP operand
                        word = this.complementSingle(word);
                    } else {            // odd word of DP operand
                        word = this.complementDoubleOdd(word);
                    }
                }
                this.drum.write(this.D.value, word);
                break;
            case 2: // TVA (transfer via AR) or AV (absolute value)
                if (this.S.value != AR) {   // transfer via AR
                    this.drum.write(this.D.value, this.drum.read(AR));
                    this.drum.write(AR, word);
                } else {                    // absolute value
                    this.drum.write(this.D.value, word & Processor.absWordMask);
                }
                break;
            case 3: // AVA ("add" via AR) or SU ("subtract": change sign)
                if (this.S.value != AR) {   // "add" via AR
                    this.drum.write(this.D.value, this.drum.read(AR));
                    if (!this.C1.value) {   // SP operation
                        this.drum.write(AR, this.complementSingle(word));
                    } else {                // DP operation
                        if (this.drum.L2 == 0) {    // even word of DP operand
                            this.drum.write(AR, this.complementSingle(word));
                        } else {                    // odd word of DP operand
                            this.drum.write(AR, this.complementDoubleOdd(word));
                        }
                    }
                } else {                    // "subtract": reverse sign and complement if now negative
                    if (!this.C1.value) {   // SP operation
                        this.drum.write(this.complementSingle(word ^ 1));
                    } else {                // DP operation
                        if (this.drum.L2 == 0) {    // even word of DP operand
                            this.drum.write(this.complementSingle(word ^ 1));
                        } else {            // odd word of DP operand
                            this.drum.write(this.complementDoubleOdd(word));
                        }
                    }
                }
                break;
            } // switch this.CA
        });
    }

    /**************************************/
    transferToTest() {
        /* Executes a transfer from any source to TEST (D=27). If any single- or
        double-precision value is non-zero, CQ is set to cause the next command
        to be taken from N+1. Note that since the test is for non-zero, negative
        values do not need to be complemented before the test.  */

        if (this.S.value >= 28 && this.CA.value >= 2) {
            this.violation("TR D=27: CH>=2 S=>28");
        }

        this.transferDriver(() => {
            let word = this.readSource();
            if (!this.C1.value || this.drum.L2 == 0) {
                word &= Processor.absWordMask;
            }

            switch (this.CA.value) {
            case 0: // TR (transfer)
            case 1: // AD ("add": complement negative numbers)
                if (word) {
                    this.CQ.value = 1;
                }
                break;
            case 2: // TVA (transfer via AR) or AV (absolute value)
                if (this.S.value < 28) {
                    if (!this.C1.value || this.drum.L1 == 0) {
                        if (this.drum.read(AR) & Processor.absWordMask) {
                            this.CQ.value = 1;
                        }
                        this.drum.write(AR, word & Processor.absWordMask);
                    } else {
                        if (this.drum.read(AR)) {
                            this.CQ.value = 1;
                        }
                        this.drum.write(AR, word);
                    }
                }
                break;
            case 3: // SU ("subtract": change sign)
                if (this.drum.read(AR)) {
                    this.CQ.value = 1;
                }

                if (this.S.value < 28) {
                    if (!this.C1.value) {
                        if (this.drum.read(AR) & Processor.absWordMask) {
                            this.CQ.value = 1;
                        }
                        this.drum.write(AR, this.complementSingle(word ^ 1));    // change sign bit
                    } else {
                        if (this.drum.L2 == 0) {    // even word of DP operand
                            if (this.drum.read(AR) & Processor.absWordMask) {
                                this.CQ.value = 1;
                            }
                            this.drum.write(AR, this.complementSingle(word ^ 1));
                        } else {            // odd word of DP operand
                            if (this.drum.read(AR)) {
                                this.CQ.value = 1;
                            }
                            this.drum.write(AR, this.complementDoubleOdd(word));
                        }

                    }
                }
                break;
            } // switch this.CA
        });
    }

    /**************************************/
    transferToID() {
        /* Executes a transfer from any source to ID (D=25) */

        this.transferDriver(() => {
            let word = this.readSource();

            switch (this.CA.value) {
            case 0: // TR
                switch (this.S.value) {
                case 24:    // MQ
                case 25:    // ID
                case 26:    // PN
                    this.drum.write(PN, 0);     // clear this half of PN
                    if (!this.C1.value || this.drum.L2 == 0) {
                        this.drum.write(ID, word & Processor.absWordMask);
                    } else {
                        this.drum.write(ID, word);
                    }
                    break;
                default:    // S = 0..23 or 27..31
                    this.drum.write(PN, 0);     // clear this half of PN
                    if (!this.C1.value || this.drum.L2 == 0) {
                        this.IP.value = word & 1;       // copy this sign bit
                        this.drum.write(ID, word & Processor.absWordMask);
                    } else {
                        this.drum.write(ID, word);
                    }
                    break;
                } // switch this.S
                break;

            case 2: // TVA
                switch (this.S.value) {
                case 24:    // MQ
                case 25:    // ID
                case 26:    // PN
                    if (this.drum.L2 == 0) {    // even word time
                        this.drum.write(ID, 0);                 // clear ID-0
                        this.drum.write(PN, 0);                 // clear PN-0
                        this.drum.write(AR, word & Processor.absWordMask);
                    } else {
                        this.drum.write(ID, this.drum.read(AR) & Processor.absWordMask); // copy AR to ID-1
                        this.drum.write(PN, 0);                 // clear PN-1
                        if (this.C1.value) {                    // double-precision
                            this.drum.write(AR, word);
                        } else {
                            this.drum.write(AR, word & Processor.absWordMask);
                        }
                    }
                    break;
                case 28:    // AR
                case 29:    // 20.IR
                case 30:    // 20/.21
                case 31:    // 20.21
                    if (!this.C1.value || this.drum.L2 == 0) {
                        this.drum.write(ID, word & Processor.absWordMask);
                    } else {
                        this.drum.write(ID, word);
                    }
                    break;
                default:    // S = 0..23 or 27
                    if (this.drum.L2 == 0) {    // even word time
                        this.drum.write(ID, 0);                 // clear ID-0
                        this.drum.write(PN, 0);                 // clear PN-0
                        this.drum.write(AR, word & Processor.absWordMask);
                        this.IP.value = word & 1;
                    } else {
                        this.drum.write(ID, this.drum.read(AR) & Processor.absWordMask); // copy AR to ID-1
                        this.drum.write(PN, 0);                 // clear PN-1
                        if (this.C1.value) {                    // double-precision
                            this.drum.write(AR, word);
                        } else {
                            this.drum.write(AR, word & Processor.absWordMask);
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
        /* Executes a transfer from any source to MQ or PN (D=24, 26). There are
        some slight differences between D=24 and D=26 when copying two-word
        registers with characteristic=0 */

        this.transferDriver(() => {
            let word = this.readSource();

            switch (this.CA.value) {
            case 0: // TR
                switch (this.S.value) {
                case 24:    // MQ
                case 25:    // ID
                    if (!this.C1.value || this.drum.L2 == 0) {
                        this.drum.write(dest, word & Processor.absWordMask);
                    } else {
                        this.drum.write(dest, word);
                    }
                    break;
                case 26:    // PN
                    if (dest == PN) {           // PN -> PN
                        if (!this.C1.value || this.drum.L2 == 0) {
                            word = (word & Processor.absWordMask) | this.IP.value;
                            this.drum.write(dest, this.complementSingle(word));
                        } else {
                            this.drum.write(dest, this.complementDoubleOdd(word));
                        }
                    } else {                    // PN -> MQ works like ID/MQ -> MQ
                        if (!this.C1.value || this.drum.L2 == 0) {
                            this.drum.write(dest, word & Processor.absWordMask);
                        } else {
                            this.drum.write(dest, word);
                        }
                    }
                    break;
                default:    // S = 0..23 or 27..31
                    if (!this.C1.value || this.drum.L2 == 0) {
                        if (word & 1) {
                            this.IP.flip();     // reverse IP is word is negative
                        }
                        this.drum.write(dest, word & Processor.absWordMask);
                    } else {
                        this.drum.write(dest, word);
                    }
                    break;
                } // switch this.S
                break;

            case 2: // TVA
                switch (this.S.value) {
                case 24:    // MQ
                case 25:    // ID
                case 26:    // PN
                    if (this.drum.L2 == 0) {    // even word time
                        this.drum.write(dest, 0);               // clear dest-even
                        this.drum.write(AR, word & Processor.absWordMask);
                    } else {
                        this.drum.write(dest, this.drum.read(AR) & Processor.absWordMask); // copy AR to dest-odd
                        if (this.C1.value) {                    // double-precision
                            this.drum.write(AR, word);
                        } else {
                            this.drum.write(AR, word & Processor.absWordMask);
                        }
                    }
                    break;
                case 28:    // AR
                case 29:    // 20.IR
                case 30:    // 20/.21
                case 31:    // 20.21
                    if (!this.C1.value || this.drum.L2 == 0) {
                        this.drum.write(dest, word & Processor.absWordMask);
                    } else {
                        this.drum.write(dest, word);
                    }
                    break;
                default:    // S = 0..23 or 27
                    if (this.drum.L2 == 0) {    // even word time
                        this.drum.write(dest, 0);               // clear even side of dest
                        this.drum.write(AR, word & Processor.absWordMask);
                        if (word & 1) {
                            this.IP.flip();     // reverse IP is word is negative
                        }
                    } else {
                        this.drum.write(dest, this.drum.read(AR) & Processor.absWordMask); // copy AR to dest-odd
                        if (this.C1.value) {                    // double-precision
                            this.drum.write(AR, word);
                        } else {
                            this.drum.write(AR, word & Processor.absWordMask);
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
        /* Executes a transfer from any source to AR (D=28). Note that for D=28,
        "via AR" operations are not supported, and instead characteristics 2 & 3
        perform absolute value and negation, respectively */

        this.transferDriver(() => {
            let word = this.readSource();

            switch (this.CA.value) {
            case 0: // TR
                this.drum.write(AR, word);
                break;
            case 1: // AD
                if (!this.C1.value) {   // SP operation
                    this.drum.write(AR, this.complementSingle(word));
                } else {                // DP operation
                    if (this.drum.L2 == 0) {    // even word of DP operand
                        this.drum.write(AR, this.complementSingle(word));
                    } else {            // odd word of DP operand
                        this.drum.write(AR, this.complementDoubleOdd(word));
                    }
                }
                break;
            case 2: // AV
                this.drum.write(AR, word & Processor.absWordMask);
                break;
            case 3: // SU
                if (!this.C1.value) {   // SP operation
                    this.drum.write(AR, this.complementSingle(word ^ 1)); // change sign bit
                } else {                // DP operation
                    if (this.drum.L2 == 0) {    // even word of DP operand
                        this.drum.write(AR, this.complementSingle(word ^ 1));
                    } else {            // odd word of DP operand
                        this.drum.write(AR, this.complementDoubleOdd(word));
                    }
                }
                break;
            } // switch this.CA
        });
    }

    /**************************************/
    addToAR() {
        /* Executes an addition from any source to AR (D=29).  */

        this.transferDriver(() => {
            let word = this.readSource();

            switch (this.CA.value) {
            case 0: // TR
                this.drum.write(AR, this.addSingle(this.drum.read(AR), word));
                break;
            case 1: // AD
                if (!this.C1.value) {   // SP operation
                    this.drum.write(AR, this.addSingle(this.drum.read(AR), this.complementSingle(word)));
                } else {                // DP operation
                    if (this.drum.L2 == 0) {    // even word of DP operand
                        this.drum.write(AR, this.addSingle(this.drum.read(AR), this.complementSingle(word)));
                    } else {            // odd word of DP operand
                        this.drum.write(AR, this.addSingle(this.drum.read(AR), this.complementDoubleOdd(word)));
                    }
                }
                break;
            case 2: // AV
                if (!this.C1.value) {   // SP operation
                    this.drum.write(AR, this.addSingle(this.drum.read(AR), word & Processor.absWordMask));
                } else {                // DP operation
                    if (this.drum.L2 == 0) {    // even word of DP operand
                        this.drum.write(AR, this.addSingle(this.drum.read(AR), word & Processor.absWordMask));
                    } else {            // odd word of DP operand
                        this.drum.write(AR, this.addSingle(this.drum.read(AR), this.complementDoubleOdd(word)));
                    }
                }
                break;
            case 3: // SU
                if (!this.C1.value) {   // SP operation
                    this.drum.write(AR, this.addSingle(this.drum.read(AR), this.complementSingle(word ^ 1))); // change sign bit
                } else {                // DP operation
                    if (this.drum.L2 == 0) {    // even word of DP operand
                        this.drum.write(AR, this.addSingle(this.drum.read(AR), this.complementSingle(word ^ 1)));
                    } else {            // odd word of DP operand
                        this.drum.write(AR, this.addSingle(this.drum.read(AR), this.complementDoubleOdd(word)));
                    }
                }
                break;
            } // switch this.CA
        });
    }

    /**************************************/
    addToPN() {
        /* Executes an addition from any source to PN (D=30).  */
        let aSign = 0;                  // sign of augend (PN)
        let bSign = 0;                  // sign of addend (source word)
        let carry = 0;                  // carry bit from even word to odd word
        let pn = 0;                     // local copy of current PN
        let pnSign = 0;                 // final sign to be applied to PN
        let rawSign = 0;                // raw sign result from even word addition

        let addDoubleEven = (a, b) => {
            /* Adds the even word of a double-precison pair (b, representing the
            source word) to the even word of a, representing PN.
            Assumes negative numbers have been converted to complement form.
            Sets carry from the 30th bit of the raw sum, but does not set the
            overflow indicator. Returns the one-word partial sum */

            aSign = a & 1;              // sign of a (PN)
            bSign = b & 1;              // sign of b (source word)

            // Zero the original signs in the words and develop the raw sum, carry, and sign.
            let sum = (a & Processor.absWordMask) + (b & Processor.absWordMask);
            carry = (sum >> 29) & 1;    // carry into the odd word
            rawsSign = aSign ^ bSign;   // add the signs without carry for use in the odd word

            // Put the sum back in G-15 sign format and return it
            return sum & Processor.wordMask;
        }

        let addDoubleOdd = (a, b) => {
            /* Adds the odd word of a double-precision pair (b, representing the
            source word) to the odd word of a, representing PN. Assumes negative
            numbers have been converted to complement form. Sets the overflow
            indicator if the signs of the operands are the same and the sign of
            the sum does not match. Computes the final sign and returns the sum */

            // Put the raw sign in its 2s-complement place and develop the raw sum.
            let sum = (a | (rawSign << 29)) + b + carry;
            let pnSign = (sum >> 29) & 1;

            // Check for overflow -- if the signs are the same, then rawSign=0.
            if (!rawSign && aSign != pnSign) {
                this.FO.value = 1;
            }

            // Return the sum
            return sum & Processor.wordMask;
        }

        this.transferDriver(() => {
            let isEven = (this.drum.L2 == 0);   // at even word
            let pn = this.drum.read(30);
            let word = this.readSource();

            if (isEven) {               // establish current PN sign
                pn = (pn & Processor.absWordMask) | pnSign;
            }

            switch (this.CA.value) {
            case 0: // TR
                if (!this.C1.value || isEven) {
                    this.drum.write(30, addDoubleEven(pn, word));
                } else {
                    this.drum.write(30, this.addDoubleOdd(pn, word));
                }
                break;
            case 1: // AD
                if (!this.C1.value || isEven) {
                    pn = addDoubleEven(pn, this.complementSingle(word));
                } else {            // odd word of DP operand
                    pn = addDoubleOdd(pn, this.complementDoubleOdd(word));
                }
                break;
            case 2: // AV
                if (!this.C1.value || isEven) {
                    pn = addDoubleEven(pn, word & Processor.absWordMask);
                } else {
                    pn = addDoubleOdd(pn, this.complementDoubleOdd(word));
                }
                break;
            case 3: // SU
                if (!this.C1.value || isEven) {
                    pn = addDoubleEven(pn, this.complementSingle(word ^ 1)); // change sign bit
                } else {
                    pn = addDoubleEven(pn, this.complementDoubleOdd(word));
                }
                break;
            } // switch this.CA
        });

        // Finally, apply the final sign of the addition to the even word of PN
        this.drum.setPNSign(pnSign);
    }

    /**************************************/
    specialCommand() {
        /* Executes a special command for D=31 */

        this.violation("D=31 not implemented");
    }

    /**************************************/
    transfer() {
        /* Executes the command currently loaded into the command register */

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
            this.transferToMQPN(MQ);
            break;
        case 25:
            this.transferToID();
            break;
        case 26:
            this.transfertoMQPN(PN)
            break;
        case 27:        // TEST for non-zero
            this.transferToTest();
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

        do {
            do {
                if (this.TR.value) {            // enter TRANSFER (execute) state
                    this.transfer();
                    if (this.CH.value) {        // halted
                        break;
                    } else if (this.BP.value && this.goSwitch == 2) {
                        this.stop();            // breakpoint encountered
                        break;
                    }
                } else {                        // enter READ COMMAND state
                    if (this.tracing) {
                        this.traceState();      // DEBUG ONLY
                    }

                    this.readCommand();
                }
            } while (this.drum.eTime < this.drum.eTimeSliceEnd);

            // If we're halted, just exit; otherwise do throttling and then continue
            if (this.CH.value) {
                break;
            } else {
                await this.drum.throttle();
            }
        } while (true);

        this.TR.value = 0;                         // reset transfer and read-command states
        this.RC.value = 0;
        this.updateLampGlow(1);
    }

    /**************************************/
    start() {
        /* Initiates the processor on the Javascript thread */

        if (this.poweredOn && this.CH.value) {
            this.CH.value = 0;          // reset HALT FF
            this.CQ.value = 0;          // reset TEST FF
            this.TR.value = 0;          // reset transfer state
            this.RC.value = 1;          // set read-command state
            this.drum.startTiming();
            this.updateLampGlow(1);     // freeze state in the lamps
            this.run();
        }
    }

    /**************************************/
    stop() {
        /* Stops running the processor on the Javascript thread */

        if (this.poweredOn && !this.CH.value) {
            this.CH.value = 1;          // set HALT FF
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
            this.run();
        }
    }

} // class Processor


// Static class properties

Processor.CDXlate = [0, 1, 2, 3, 4, 5, 19, 23];         // translate CD register to drum line numbers

Processor.wordMask = 0x1FFFFFFF;                        // 29 bits
Processor.absWordMask = 0x1FFFFFFE;                     // all but the sign bit
Processor.two28 = 0x10000000;                           // 2**28 for complementing word values
