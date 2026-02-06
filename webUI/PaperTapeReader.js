/***********************************************************************
* retro-g15/webUI PaperTapeReader.js
************************************************************************
* Copyright (c) 2022, Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* Bendix G-15 paper (photo) tape reader. Defines the paper tape input device.
*
* There are three paper-tape image formats. The first is ".pti", used by
* David Green in his collection of G-15 software. See:
*       https://www.uraone.com/computers/bendixg15/
* This format represents a tape as ASCII text using mostly the same codes as
* would be typed on the Typewriter (see below). Letter codes are interpreted
* case-insensitively.
*
* The standard binary image format, ".ptr", has one 8-bit byte per tape frame
* with the following bit arrangement:
*
*       _ _ _ 5 4 3.2 1
*
* Paul Pierce's binary image format, ".pt", has one 8-bit byte per tape frame
* with the following bit arrangement. See:
*       http://www.piercefuller.com/collect/bendix/
* These channels are in reverse order compared to the .ptr format.
*
*       _ _ _ 1 2 3.4 5
*
* The "_" are unused bits and should be zero,. The "." represents the location
* of the sprocket hole in the tape, and 1-5 are the channel numbers as used in
* the Bendix documentation.
*
* The binary and ASCII codes are as follows:
*
*     hex  graphic  description
*      00   space   (blank tape, ignored)
*      01     -     minus sign
*      02     C     carriage return
*      03     T     tabulate
*      04     S     stop
*      05     /     reload (precess line 23 to line 19 and read next block
*                   (R is also accepted on input for reload)
*      06     .     period (ignored on input)
*      07     H     wait
*   08-0F           (same as corresponding 00-07 codes)
*   10-19   0-9     decimal digits
*   1A-1F   u-z     hexadecimal digits (A-F, respectively)
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

    // Static properties

    static averageSpeed = 250;          // frames/sec
    static framesPerInch = 10;          // frame pitch on the tape
    static midpointDiameter = 3.6;      // spool diameter at midpoint of max-length tape, in
    static startStopFrames = 35;        // 3.5 inches of tape
    static tapeThickness = 0.1/25.4;    // 0.100mm = 0.003937in
    static hubDiameter = 1.0            // diameter of take-up reel hub, inch
    static hubCircumference = PaperTapeReader.hubDiameter*Math.PI;
    static hubRPS =                     // take-up hub speed, rev/sec
             PaperTapeReader.averageSpeed/PaperTapeReader.hubCircumference/PaperTapeReader.framesPerInch;

    static tapeWords = 2500;            // max words in a tape cartridge, about 170 feet of tape
                                        // (see https://en.wikipedia.org/wiki/Bendix_G-15)
    static spoolAlpha = Math.PI*(1 + 2*PaperTapeReader.tapeThickness);  // spool diameter growth factor
    static tapeFrames = PaperTapeReader.tapeWords*Util.wordBits/4; // max frames in a tape cartridge

    static commentRex = /#[^\x0D\x0A]*/g;
    static newLineRex = /[\x0D\x0A\x0C]+/g;

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
        this.rewinding = false;         // tape is currently rewinding

        this.blockNr = 0;               // current tape image block number
        this.buffer = null;             // reader input buffer (paper-tape reel)
        this.bufLength = 0;             // current input buffer length (characters)
        this.bufIndex = 0;              // 0-relative offset to next character to be read
        this.nextStartStamp = 0;        // earliest time next read can start

        this.makeBusy(false);
        this.setBlockNr(0);
        this.setReaderEmpty();
    }

    /**************************************/
    setReaderSpeed(bufIndex) {
        /* Configures the reader to match the current drum rotational speed and
        length of tape wound on the take-up hub. "bufIndex" is the offset into
        the tape buffer */
        const tapeLen = bufIndex/PaperTapeReader.framesPerInch;                 // in
        const spoolDiameter = tapeLen/PaperTapeReader.spoolAlpha*2*PaperTapeReader.tapeThickness +
                PaperTapeReader.hubDiameter;                                    // in
        const tapeSpeed = Math.PI*spoolDiameter*PaperTapeReader.hubRPS*PaperTapeReader.framesPerInch; // frames/sec

        this.speed = Math.min(tapeSpeed*Util.timingFactor, 2500);               // frames/sec
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
        this.$$("PRFormatSelect").selectedIndex = 0     // default to Auto
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
    stripComments(buf) {
        /* Strips "#" comments from a text buffer, returning a new buffer */

        return buf.replace(PaperTapeReader.commentRex, "").replace(PaperTapeReader.newLineRex, "");
    }

    /**************************************/
    prepareBuffer(imageLength) {
        /* Prepares this.buffer for more image data by assuring that there is
        sufficient room, resizing it if necessary. If any existing buffer has
        been read to its end, the buffer is treated as empty and its existing
        image data is discarded */
        let bufIndex = this.bufIndex;
        let bufLength = this.bufLength;

        if (!this.buffer) {
            this.buffer = new Uint8Array(imageLength);
            bufIndex = bufLength = 0;
        } else if (bufIndex >= bufLength) {
            bufIndex = bufLength = 0;
            this.setBlockNr(0);
        }

        if (this.buffer.length - bufLength < imageLength) {
            // Not enough room in the current buffer, so resize it
            const oldBuf = this.buffer;
            this.buffer = new Uint8Array(bufLength + imageLength);
            this.buffer.set(oldBuf, 0);
            bufLength += imageLength;
        }

        this.bufIndex = bufIndex;
        this.bufLength = bufLength;
    }

    /**************************************/
    loadAsPT(arrayBuffer) {
        /* Load the image file as binary in .pt format, which yields G-15
        binary hole patterns after reversing the low-order five bits in each
        byte */
        const image = new Uint8Array(arrayBuffer);
        const imageLength = image.length;
        let bufLength = this.bufLength;

        console.debug("loadAsPT");
        this.prepareBuffer(imageLength);
        bufLength = this.bufLength;

        for (let x=0; x<imageLength; ++x) {
            this.buffer[bufLength++] = IOCodes.rev5Bits[image[x] & 0b11111];
        }

        this.bufLength = bufLength;
        this.$$("PRTapeSupplyBar").max = bufLength;
        this.$$("PRTapeSupplyBar").value = bufLength - this.bufIndex;
        this.ready = true;
    }

    /**************************************/
    loadAsPTR(arrayBuffer) {
        /* Load the image file as binary in .ptr format, which directly yields
        G-15 binary hole patterns */
        const image = new Uint8Array(arrayBuffer);
        const imageLength = image.length;
        let bufLength = this.bufLength;

        console.debug("loadAsPTR");
        this.prepareBuffer(imageLength);
        bufLength = this.bufLength;

        for (let x=0; x<imageLength; ++x) {
            this.buffer[bufLength++] = image[x] & 0b11111;
        }

        this.bufLength = bufLength;
        this.$$("PRTapeSupplyBar").max = bufLength;
        this.$$("PRTapeSupplyBar").value = bufLength - this.bufIndex;
        this.ready = true;
    }

    /**************************************/
    loadAsPTI(image) {
        /* Load the image file as ASCII text in .pti format and converts it to
        G-15 binary hole patterns. Simply bypasses any invalid tape image
        characters and comments as if they did not exist. */
        const text = this.stripComments(image);
        const imageLength = text.length;
        let code = 0;

        console.debug("loadAsPTI");
        this.prepareBuffer(imageLength);
        let bufLength = this.bufLength;

        for (const char of text) {
            code = IOCodes.ioCodeFilter[char.charCodeAt(0) & 0x7F];
            if (code < 0xFF) {          // not an ignored character
                this.buffer[bufLength++] = code;
            }
        }

        this.bufLength = bufLength;
        this.$$("PRTapeSupplyBar").max = bufLength;
        this.$$("PRTapeSupplyBar").value = bufLength - this.bufIndex;
        this.ready = true;
    }

    /**************************************/
    async fileSelectorChange(ev) {
        /* Handle the <input type=file> onchange event when files are selected.
        For each file, load it and add it to the input buffer of the reader */
        const fileList = ev.target.files;
        const formatSelect = this.$$("PRFormatSelect");
        const formatIndex = formatSelect.selectedIndex;
        let tapeFormat = "Auto";

        if (formatIndex > 0) {
            tapeFormat = formatSelect.options[formatIndex].value;
        }

        if (!this.busy && !this.rewinding) {
            for (const file of fileList) {
                let readAs = tapeFormat;
                if (tapeFormat == "Auto") {
                    const fileName = file.name;
                    let x = fileName.lastIndexOf(".");
                    readAs = x < 0 ? ".pti" : fileName.substring(x).toLowerCase();
                }

                console.debug(`readAs ${readAs}`);
                switch (readAs) {
                case ".pt":
                    this.loadAsPT(await file.arrayBuffer());
                    break;
                case ".ptr":
                    this.loadAsPTR(await file.arrayBuffer());
                    break;
                default:
                    this.loadAsPTI(await file.text());
                    break;
                }
            }
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
            this.canceled = true;
        }
    }

    /**************************************/
    async read() {
        /* Initiates the Paper Tape Reader to begin sending frame codes to the
        Processor's I/O subsystem. Reads until a STOP code or the end of the
        tape buffer is encountered. Returns true if an attempt is made to read
        past the end of the buffer, leaving the I/O hanging. Delays for the
        reader startup time, but not for the stop time, so that the I/O can
        finish as soon as possible. Takes the stop time into account at the
        beginning of the next read, if necessary */
        let bufLength = this.bufLength; // current buffer length
        let code = 0;                   // current G-15 tape code
        let eob = false;                // end-of-block flag
        let nextFrameStamp = performance.now();         // time of next character frame
        let precessionComplete = Promise.resolve();     // signals drum is ready for next char
        let result = false;             // true if reader left hung at end-of-buffer
        let x = this.bufIndex;          // current buffer index

        this.canceled = false;
        this.makeBusy(true);
        this.setBlockNr(this.blockNr+1);
        this.setReaderSpeed(x);

        // Simulate the reader start/stop time.
        if (this.nextStartStamp > nextFrameStamp) {
            nextFrameStamp = this.nextStartStamp + this.startStopTime;  // reader is still stopping
        } else {
            nextFrameStamp += this.startStopTime;                       // reader is ready to start
        }

        // Read the next block.
        do {
            this.tapeSupplyBar.value = bufLength-x;
            if (x >= bufLength) {       // end of buffer
                this.canceled = false;
                result = eob = true;    // just quit and leave the I/O hanging
                break;
            } else {
                code = this.buffer[x];
                ++x;

                // Wait for the next frame time.
                await this.timer.delayUntil(nextFrameStamp);
                nextFrameStamp += this.framePeriod;

                // Wait for any line 23 precession to complete.
                if (this.canceled) {
                    await precessionComplete;
                    this.canceled = false;
                    eob = true;         // definitely canceled -- quit
                } else if (await precessionComplete) {
                    eob = true;         // some error detected by Processor -- quit
                } else {
                    // Send the tape code to the Processor.
                    precessionComplete = this.processor.receiveInputCode(code);
                    switch (code) {
                    case IOCodes.ioCodeReload:
                        this.setReaderSpeed(x);
                        break;
                    case IOCodes.ioCodeStop:
                        await precessionComplete;
                        eob = true;     // end of block -- quit
                        break;
                    }
                }
            }
        } while (!eob);

        this.bufIndex = x;
        this.makeBusy(false);
        this.nextStartStamp = this.startStopTime + nextFrameStamp;      // simulate reader stop time
        return result;
    }

    /**************************************/
    preload() {
        /* Preloads the tape buffer with the PPR tape image and sets the reader
        ready, as if the image had been loaded by the user from a file */

        this.prepareBuffer(PPRTapeImage.pprTapeImage.length);
        this.loadAsPTI(PPRTapeImage.pprTapeImage);
        this.bufIndex = 0;
        this.bufLength = PPRTapeImage.pprTapeImage.length;
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
        let nextFrameStamp = performance.now() + this.startStopTime;    // simulate startup time
        let x = this.bufIndex;          // point to current buffer position

        this.canceled = false;
        this.makeBusy(true);
        this.setReaderSpeed(bufLength-x);

        do {
            if (x <= 0) {
                this.bufIndex = 0;      // reset the buffer index to beginning
                this.setBlockNr(0);
                this.makeBusy(false);
                this.canceled = false;
                return true;            // and just quit, leaving the I/O hanging
            } else {
                --x;                    // examine prior character
                if (this.buffer[x] == IOCodes.ioCodeStop) {
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
    fastRewind() {
        /* Rewinds the tape image instantaineously */

        if (!this.busy && !this.rewinding) {
            this.bufIndex = 0;
            this.setBlockNr(0);
            this.$$("PRTapeSupplyBar").value = this.bufLength;
            if (this.processor.punchSwitch == 2) {
                this.$$("EnableSwitchOff").checked = true;   // turn off REWIND
                this.processor.punchSwitchChange(0);
            }
        }
    }

    /**************************************/
    async rewind() {
        /* Rewinds the tape to its beginning or until the REWIND switch is turned off */

        if (!this.rewinding) {
            this.rewinding = true;
            while (this.bufIndex > 0 && this.processor.punchSwitch == 2) {
                if (await this.reverseBlock()) {
                    break;
                }
            }

            this.makeBusy(false);
            if (this.bufIndex <= 0) {       // fully rewound
                this.bufIndex = 0;
                this.setBlockNr(0);
                if (this.processor.punchSwitch == 2) {
                    this.$$("PunchSwitchOff").checked = true;       // turn off REWIND
                    this.processor.punchSwitchChange(0);
                }
            }

            this.rewinding = false;
        }
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
