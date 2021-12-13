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

class DrumRegister extends Register {
    /* Implements a one-word register that is stored on the drum. Assumes
    that this is a one-word register that is available every word-time */

    constructor(drum, prop,, bits, clock, invisible) {
        super(bits, clock, invisible);
        this.drum = drum;
        this.prop = prop;
    }

    set value() {
        return this.set(value);
    }

    set(value) {
        super.set(value);
        value = super.value;
        drum[this.prop] = value;
        return value;
    }

    setBit(bitNr, value) {
        super.setBit(bitNr, value);
        value = super.value;
        drum[this.prop] = value;
        return value;
    }

    flipbit(bitNr) {
        super.flipBit(bitNr);
        value = super.value;
        drum[this.prop] = value;
        return value;
    }
}


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

        // Registers
        this.D  = new Register( 5, this.drum, true);    // destination line in command
        this.S  = new Register( 5, this,drum, true);    // source line in command
        this.CA = new Register( 2, this.drum, true);    // characteristic bits in command
        this.CD = new Register( 3, this.drum, true);    // current command-line designator
        this.CM = new Register(29, this.drum, true);    // command register
        this.IR = new Register(29, this.drum, false);   // input register (zero unless external circuit exists)
        this.N  = new Register( 7, this.drum, true);    // next cmd location in command
        this.OC = new Register( 5, this.drum, true);    // I/O operation code register (bit 5 = READY)
        this.OR = new Register(29, this.drum, false);   // output register (a sink unless external circuit exists)
        this.T  = new Register( 7, this.drum, true);    // timing number from command

        this.AR = new DrumRegister(this.drum, "AR", 29, this.drum, true);
        this.CM = new DrumRegister(this.drum, "CM", 29, this.drum, true);

        // General state
        this.cdLine = 0;                                // current actual command line (see CDXlate)
        this.poweredOn = false;                         // powered up and ready to run
        this.tracing = false;                           // trace command debugging

        this.goSwitch = 0;                              // 0=halt, 1=GO, 2=BP
    }

    /**************************************/
    readCommand() {
        /* Reads the next command into the command register (CM) and sets up the
        processor state to execute that command */
        let loc = this.N;

        if (this.CQ.value) {            // check the result of a prior TEST
            ++loc;
            this.CQ.value = 0;
        }

        this.drum.waitUntil(this.cdLine, loc);
        let cmd = this.drum.read(this.cdLine);

        this.C1.value = cmd & 0x01;             // single/double mode
        this.D.value =  (cmd >> 1) & 0x1F;      // destination line
        this.S.value =  (cmd >> 6) & 0x1F;      // source line
        this.CA.value = (cmd >> 11) & 0x1F;     // characteristic code
        this.N.value =  (cmd >> 13) & 0x7F;     // next command location
        this.BP.value = (cmd >> 20) & 0x01;     // breakpoint flag
        this.T.value =  (cmd >> 21) & 0x7F;     // operand timing number
        this.DI.value = (cmd >> 28) & 0x01;     // immediate/deferred execution bit

        this.CM.value = cmd ^ 0b_0_1111111_0_1111111_00_00000_00000_0; // complement T and N (for display only)

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
            this.N = (this.N - 20 + Drum.longLineSize) % Drum.longLineSize;
            if (this.D == 31 && (this.S & 0b11100) != 0b11000) {    // not 24-27: MUL, DIV, SHIFT, NORM
                this.T = (this.N - 20 + Drum.longLineSize) % Drum.longLineSize;
            }
        }

        // Transition from read-command to transfer state
        this.RC.value = 0;                      // end of read-command state
        this.TR.value = 1;                      // start of transfer state
        this.drum.waitFor(1);                   // advance past command word
        if (this.DI) {                          // deferred commands delay at least one word before transfer
            this.drum.waitFor(1);
        }
    }

    /**************************************/
    complementSingle(word) {
        /* Converts a single-precision word or the even word of a double-
        precision pair between complement and non-complement form */
        let sign = word & 1;

        if (sign) {                     // negative sign
            let mag = word >> 1;
            return (((0x10000000 - mag) << 1) + sign) & Processor.wordMask;
        } else {
            return word;
        }
    }

    /**************************************/
    complementDoubleOdd(word, evenWord) {
        /* Converts the second word of a double-precision operand between
        complement forms, returning the converted word. evenWord must be the
        corresponding even word of the pair, before complementing. A twos-
        complement carry into the odd word can occur only if the even word
        is zero */
        let evenSign = evenWord & 1;    // even word sign bit

        if (evenSign) {                 // even word is negative
            let evenMag = evenWord >> 1;
            return (0x1FFFFFFF - word + (evenMag == 0 ? 1 : 0)) & Processor.wordMask;
        } else {
            return word;
        }
    }

    /**************************************/
    transferNormal() {
        /* Executes a transfer between normal (108- and 4-word) lines 0-23 */
        let count = 1;                  // defaults to one word time
        let evenWord = 0;               // last DP even word seen

        if (this.DI) {
            // Deferred execution, transfer one or two words at time T.
            this.drum.waitUntil(this.T);
            if (this.C1 && this.drum.L2 == 0) {
                ++count;                // DP operand starts on even word
            }
        } else {
            // Immediate execution, transfer at current word time through T-1.
            count = this.T - this.drum.L;
            if (count <= 0) {
                count += Drum.longLineSize;
            }
        }

        do {
            let word = this.drum.read(this.S);
            switch (this.CA) {
            case 0:
                this.drum.write(this.D, word);
                break;
            case 1:
                if (!this.C1) {          // SP operation
                    word = complementSingle(word);
                } else {                // DP operation
                    if (this.drum.L2 == 0) {    // even word of DP operand
                        evenWord = word;
                        word = complementSingle(word);
                    } else {            // odd word of DP operand
                        word = complementDoubleOdd(word, evenWord);
                    }
                }
                this.drum.write(this.D, word);
                break;
            case 2:
                this.drum.write(this.D, this.AR.value);
                this.AR.value = word;
                break;
            case 3:
                this.drum.write(this.D, this.AR.value);
                if (!this.C1) {          // SP operation
                    this.AR.value = complementSingle(word);
                } else {                // DP operation
                    if (this.drum.L2 == 0) {    // even word of DP operand
                        evenWord = word;
                        this.AR.value = complementSingle(word);
                    } else {            // odd word of DP operand
                        this.AR.value = complementDoubleOdd(word, evenWord);
                    }
                }
                break;
            }

            this.drum.waitFor(1);
        } while (--count > 0);
    }

    /**************************************/
    transfer() {
        /* Executes the command currently loaded into the command register */

        if (this.D < 24) {
            if (this.S < 24) {
                this.transferNormal();  // dispense with low-hanging fruit
            } else {
                ....
            }

        } else {

        // 2-word registers

            switch (this.D) {
            case 24:
            case 25:
            case 26:
            case 27:
            case 28:
            case 29:
            case 30:
            case 31:
                break;
            } // switch this.D
        }

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
                    } else if (this.BP && this.goSwitch == 2) {
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
        var stamp = performance.now();

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