/***********************************************************************
* retro-g15/webUI PaperTapeReader.js
************************************************************************
* Copyright (c) 2022, Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* Bendix G-15 paper (photo) tape reader.
*
* Defines the paper tape input device.
*
************************************************************************
* 2022-03-15  P.Kimpel
*   Original version, from retro-205 D205ConsoleInput.js.
***********************************************************************/

export {PaperTapeReader};

import * as Util from "../emulator/Util.js";
import * as IOCodes from "../emulator/IOCodes.js";
import * as PPRTapeImage from "./resources/PPRTapeImage.js";

class PaperTapeReader {

    constructor(context) {
        /* Initializes and wires up events for the Paper Tape Reader.
        "context" is an object passing other objects and callback functions from
        the global script:
            $$() returns an object reference from its id value
            processor is the Processor object
        */
        let $$ = this.$$ = context.$$;
        this.processor = context.processor;
        this.tapeSupplyBar = $$("PRTapeSupplyBar");
        this.timer = new Util.Timer();
        this.boundFileSelectorChange = this.fileSelectorChange.bind(this);
        this.boundRewindButtonClick = this.rewindButtonClick.bind(this);
        this.boundUnloadButtonClick = this.unloadButtonClick.bind(this);

        this.framePeriod = 0;                           // reader speed, ms/frame
        this.startStopTime = 0;                         // reader start/stop time, ms
        this.setSpeed(PaperTapeReader.defaultSpeed);    // frames/sec

        this.clear();                                   // creates additional instance variables

        $$("PRFileSelector").addEventListener("change", this.boundFileSelectorChange);
        $$("PRRewindBtn").addEventListener("click", this.boundRewindButtonClick);
        $$("PRUnloadBtn").addEventListener("click", this.boundUnloadButtonClick);
        $$("PRUnloadCaption").addEventListener("click", this.boundUnloadButtonClick);
    }

    /**************************************/
    clear() {
        /* Initializes (and if necessary, creates) the reader unit state */

        this.ready = false;             // a tape has been loaded into the reader
        this.busy = false;              // an I/O is in progress
        this.canceled = false;          // current I/O canceled

        this.blockNr = 0;               // current tape image block number
        this.buffer = "";               // reader input buffer (paper-tape reel)
        this.bufLength = 0;             // current input buffer length (characters)
        this.bufIndex = 0;              // 0-relative offset to next character to be read

        this.makeBusy(false);
        this.setBlockNr(0);
    }

    /**************************************/
    setSpeed(framesPerSec) {
        /* Configures the reader for a specified speed in frames/sec */

        this.speed = framesPerSec;
        this.framePeriod = 1000/this.speed;                                     // ms/frame
        this.startStopTime = this.framePeriod*PaperTapeReader.startStopFrames;  // ms
    }

    /**************************************/
    setReaderEmpty() {
        /* Sets the reader to a not-ready status and empties the buffer */

        this.ready = false;
        this.tapeSupplyBar.value = 0;
        this.buffer = "";                   // discard the input buffer
        this.bufLength = 0;
        this.bufIndex = 0;
        this.setBlockNr(0);
        this.$$("PRFileSelector").value = null; // reset the control so the same file can be reloaded
    }

    /**************************************/
    rewindButtonClick(ev) {
        /* Rewinds the tape in response to the REWIND button */

        if (this.ready && !this.busy) {
            this.rewind();
        }
    }

    /**************************************/
    unloadButtonClick(ev) {
        /* Clears the internal tape buffer in response to the UNLOAD button */

        if (this.ready && !this.busy) {
            this.setReaderEmpty();
        }
    }

    /**************************************/
    fileSelectorChange(ev) {
        /* Handle the <input type=file> onchange event when files are selected. For each
        file, load it and append it to the input buffer of the reader */
        let tape;
        let f = ev.target.files;
        let x;

        let fileLoaderLoad = (ev) => {
            /* Handle the onload event for a Text FileReader */

            if (this.bufIndex >= this.bufLength) {
                this.buffer = ev.target.result;
                this.setBlockNr(0);
            } else {
                switch (this.buffer.charAt(this.buffer.length-1)) {
                case "\r":
                case "\n":
                case "\f":
                    break;                  // do nothing -- the last word has a delimiter
                default:
                    this.buffer += "\n";    // so the next tape starts on a new line
                    break;
                }
                this.buffer = this.buffer.substring(this.bufIndex) + ev.target.result;
            }

            this.bufIndex = 0;
            this.bufLength = this.buffer.length;
            this.$$("PRTapeSupplyBar").value = this.bufLength;
            this.$$("PRTapeSupplyBar").max = this.bufLength;
            this.ready = true;
        }

        for (x=f.length-1; x>=0; x--) {
            tape = new FileReader();
            tape.onload = fileLoaderLoad;
            tape.readAsText(f[x]);
        }
    }

    /**************************************/
    makeBusy(busy) {
        /* Makes the reader busy (I/O in progress) or not busy (idle) */

        this.busy = busy;
        if (busy) {
            this.$$("PRCaption").classList.add("active");
        } else {
            this.$$("PRCaption").classList.remove("active");
        }
    }

    /**************************************/
    setBlockNr(blockNr) {
        /* Updates this.blockNr and the PRBlockNr annunciator */

       this.blockNr = blockNr;
       this.$$("PRBlockNr").textContent = blockNr;
    }

    /**************************************/
    cancel() {
        /* Cancels the I/O currently in process */

        if (this.busy) {
            this.makeBusy(false);
            this.canceled = true;
        }
    }

    /**************************************/
    async read() {
        /* Initiates the Paper Tape Reader to begin sending frame codes to the
        Processor's I/O subsystem. Reads until a STOP code or the end of the tape
        buffer is encountered. Simply bypasses any invalid tape image characters
        and comments as if they did not exist. Returns true if an attempt is
        made to read past the end of the buffer, leaving the I/O hanging */
        let bufLength = this.bufLength; // current buffer length
        let bypass = false;             // bypass comment text after "#"
        let c = "";                     // current character
        let code = 0;                   // current G-15 internal code
        let eob = false;                // end-of-block flag
        let nextFrameStamp = performance.now() + this.startStopTime;    // simulate startup time
        let precessionComplete = Promise.resolve();
        let x = this.bufIndex;          // current buffer index

        this.canceled = false;
        this.makeBusy(true);
        this.setBlockNr(this.blockNr+1);

        do {
            this.tapeSupplyBar.value = bufLength-x;
            if (x >= bufLength) {       // end of buffer
                this.bufIndex = x;
                return true;            // just quit and leave the I/O hanging
            } else {
                c = this.buffer.charAt(x);
                ++x;
                switch (c) {
                case "#":
                    bypass = true;      // start bypassing comment text
                    break;
                case "\n":
                case "\r":
                    bypass = false;     // end bypassing comment text
                    break;
                }

                if (!bypass) {
                    code = IOCodes.ioCodeFilter[c.charCodeAt(0) & 0x7F];
                    if (code < 0xFF) {  // not an ignored character
                        // Wait for the next frame time.
                        await this.timer.delayUntil(nextFrameStamp);
                        nextFrameStamp += this.framePeriod;

                        // Wait for any line 23 precession to complete.
                        if (await precessionComplete) {
                            eob = true;                 // some error detected by Processor -- quit
                        } else if (this.canceled) {
                            this.canceled = false;
                            eob = true;                 // definitely canceled -- quit
                        } else {
                            // Send the tape code to the Processor.
                            precessionComplete = this.processor.receiveInputCode(code);
                            if (code == IOCodes.ioCodeStop) {
                                await precessionComplete;
                                eob = true;             // end of block -- quit
                            }
                        }
                    }
                }
            }
        } while (!eob);

        this.bufIndex = x;
        this.makeBusy(false);
        await this.timer.set(this.startStopTime);       // simulate stop time
        return false;
    }

    /**************************************/
    preload() {
        /* Preloads the tape buffer with the PPR tape image and sets the reader
        ready, as if the image had been loaded by the user from a file */

        this.buffer = PPRTapeImage.pprTapeImage;
        this.bufIndex = 0;
        this.bufLength = this.buffer.length;
        this.setBlockNr(0);
        this.$$("PRTapeSupplyBar").value = this.bufLength;
        this.$$("PRTapeSupplyBar").max = this.bufLength;
        this.ready = true;
    }

    /**************************************/
    async reverseBlock() {
        /* Reverses the tape until the prior stop code is detected and exits.
        If we encounter the beginning of tape, just exit with the buffer index
        pointing to the beginning of the buffer. Returns true if an attempt is made
        to reverse past the beginning of the buffer, leaving the I/O hanging */
        let bufLength = this.bufLength; // current buffer length
        let code = 0;                   // translated frame code
        let nextFrameStamp = performance.now() + this.startStopTime;    // simulate startup time
        let x = this.bufIndex;          // point to current buffer position

        this.canceled = false;
        this.makeBusy(true);

        do {
            if (x <= 0) {
                this.bufIndex = 0;      // reset the buffer index to beginning
                this.setBlockNr(0);
                return true;            // and just quit, leaving the I/O hanging
            } else {
                --x;                    // examine prior character
                code = IOCodes.ioCodeFilter[this.buffer.charCodeAt(x) & 0x7F];
                if (code == IOCodes.ioCodeStop) {
                    break;              // out of do loop
                } else {
                    this.tapeSupplyBar.value = bufLength-x;
                    await this.timer.delayUntil(nextFrameStamp);
                    nextFrameStamp += this.framePeriod;
                    if (this.canceled) {
                        this.canceled = false;
                        break; // out of do loop
                    }
                }
            }
        } while (true);

        this.bufIndex = x;
        this.makeBusy(false);
        await this.timer.set(this.startStopTime);       // simulate stop time
        this.setBlockNr(x > 0 ? this.blockNr-1 : 0);

        return false;
    }

    /**************************************/
    async rewind() {
        /* Rewinds the tape to its beginning */

        while (this.bufIndex > 0) {
            if (await this.reverseBlock()) {
                break;
            }
        }

        this.bufIndex = 0;
        this.setBlockNr(0);
        this.makeBusy(false);
    }

    /**************************************/
    shutDown() {
        /* Shuts down the device */

        this.timer.clear();
        this.$$("PRFileSelector").removeEventListener("change", this.boundFileSelectorChange);
        this.$$("PRRewindBtn").removeEventListener("click", this.boundRewindButtonClick);
        this.$$("PRUnloadBtn").removeEventListener("click", this.boundUnloadButtonClick);
        this.$$("PRUnloadCaption").removeEventListener("click", this.boundUnloadButtonClick);
    }
}


// Static properties

PaperTapeReader.defaultSpeed = 250;     // frames/sec
PaperTapeReader.startStopFrames = 35;   // 3.5 inches of tape
