/***********************************************************************
* retro-g15/webUI PaperTapePunch.js
************************************************************************
* Copyright (c) 2022, Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* Bendix G-15 paper (photo) tape punch.
*
* Defines the paper tape output device.
*
************************************************************************
* 2022-03-24  P.Kimpel
*   Original version, from retro-205 D205ConsoleInput.js.
***********************************************************************/

export {PaperTapePunch};

import * as Util from "../emulator/Util.js";
import * as IOCodes from "../emulator/IOCodes.js";
import {openPopup} from "./PopupUtil.js";

class PaperTapePunch {

    static bufferLimit = 0x3FFFF;       // maximum output that will be buffered (about 4 hours worth)
    static viewMax = 60;                // characters retained in the tape view (originally 90)
    static punchLeaderCount = 75;       // blank frames in a tape leader
    static interpunct = "\u00B7";       // middle-dot for blank frames in the PTView box
    static tapeCodes = [
        " ", "-", "C", "T", "S", "/", ".", "~", " ", "-", "C", "T", "S", "/", ".", "~",
        "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "u", "v", "w", "x", "y", "z"];

    constructor(context) {
        /* Initializes and wires up events for the Paper Tape punch.
        "context" is an object passing other objects and callback functions from
        the global script:
            $$() returns an object reference from its id value
            processor is the Processor object
            window is the ControlPanel window
        */
        let $$ = this.$$ = context.$$;
        this.processor = context.processor;
        this.window = context.window;
        this.doc = this.window.document;
        this.tapeView = $$("PTView");
        this.boundMenuClick = this.menuClick.bind(this);
        this.buffer = new Uint8Array(PaperTapePunch.bufferLimit+1);

        this.clear();

        $$("PTUnloadBtn").addEventListener("click", this.boundMenuClick);
        $$("PTUnloadCaption").addEventListener("click", this.boundMenuClick);
    }

    /**************************************/
    clear() {
        /* Initializes (and if necessary, creates) the punch unit state */

        this.ready = true;              // punch is ready for output
        this.canceled = false;          // current I/O canceled

        this.makeBusy(false);
        this.setPunchEmpty();
    }

    /**************************************/
    setPunchEmpty() {
        /* Empties the punch output buffer */

        this.buffer.fill(0);            // punch output buffer
        this.bufLength = 0;             // current output buffer length (characters)
        this.tapeView.value = "";
    }

    /**************************************/
    async punchLeaderFrames() {
        /* Initiates and terminates punching tape-feed frames */
        const buf = this.buffer;
        const timer = new Util.Timer();
        const framePeriod = Util.drumCycleTime*2;       // about 17.2ms at 1800 RPM
        let len = this.bufLength;
        let nextFrameStamp = performance.now();

        this.$$("PTPunchRunBtn").classList.add("punchingLeader");
        for (let x=PaperTapePunch.punchLeaderCount; x>0; --x) {
            nextFrameStamp += framePeriod;
            await timer.delayUntil(nextFrameStamp);
            if (len >= PaperTapePunch.bufferLimit) {
                break;
            } else {
                this.buffer[len] = IOCodes.ioCodeSpace;
                ++len;

                // Update the tape view control
                let view = this.tapeView.value; // current tape view contents
                if (view.length < PaperTapePunch.viewMax) {
                    this.tapeView.value = view + PaperTapePunch.interpunct;
                } else {
                    this.tapeView.value =
                            view.slice(1-PaperTapePunch.viewMax) + PaperTapePunch.interpunct;
                }
            }
        }

        this.$$("PTPunchRunBtn").classList.remove("punchingLeader");
        this.bufLength = len;
    }

    /**************************************/
    btoaUint8(bytes, start, end) {
        /* Converts a Uint8Array directly to base-64 encoding without using
        window.btoa and returns the base-64 string. "start" is the 0-relative
        index to the first byte; "end" is the 0-relative index to the ending
        byte + 1. Adapted from https://gist.github.com/jonleighton/958841 */
        let b64 = "";
        const byteLength = end - start;
        const remainderLength = byteLength % 3;
        const mainLength = byteLength - remainderLength;

        const encoding = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

        // Main loop deals with bytes in chunks of 3.
        for (let i=start; i<mainLength; i+=3) {
            // Combine the three bytes into a single integer.
            const chunk = (((bytes[i] << 8) | bytes[i+1]) << 8) | bytes[i+2];

            // Extract 6-bit segments from the triplet and convert to the ASCII encoding.
            b64 += encoding[(chunk & 0xFC0000) >> 18] +
                   encoding[(chunk &  0x3F000) >> 12] +
                   encoding[(chunk &    0xFC0) >>  6] +
                   encoding[chunk &      0x3F];
        }

        // Deal with any remaining bytes and padding.
        if (remainderLength == 1) {
           // Encode the high-order 6 and low-order 2 bits, and add padding.
           const chunk = bytes[mainLength];
           b64 += encoding[(chunk & 0xFC) >> 2] +
                  encoding[(chunk & 0x03) << 4] + "==";
        } else if (remainderLength == 2) {
           // Encode the high-order 6 bits of the first byte, plus the low-order
           // 2 bits of the first byte with the high-order 4 bits of the second
           // byte, and add padding.
           const chunk = (bytes[mainLength] << 8) | bytes[mainLength+1];
           b64 += encoding[(chunk & 0xFC00) >> 10] +
                  encoding[(chunk &  0x3F0) >> 4] +
                  encoding[(chunk &    0xF) << 2] + "=";
        }

        return b64;
    }

    /**************************************/
    extractTape() {
        /* Copies the text contents of the "paper" area of the device, opens a new
        temporary window, and pastes that text into the window so it can be copied
        or saved by the user */

        openPopup(this.window, "./FramePaper.html", "",
                "scrollbars,resizable,width=500,height=500",
                this, (ev) => {
            const doc = ev.target;
            const win = doc.defaultView;
            const buf = this.buffer;
            const len = this.bufLength;
            let text = "";

            for (let x=0; x<len; ++x) {
                const code = buf[x];
                text += PaperTapePunch.tapeCodes[code];
                switch (code) {
                case IOCodes.IOCodeReload:
                    text += "\n";
                    break;
                case IOCodes.IOCodeStop:
                    text += "\n\n";
                    break;
                }
            }

            doc.title = "retro-g15 Paper Tape Punch Output";
            win.moveTo((screen.availWidth-win.outerWidth)/2, (screen.availHeight-win.outerHeight)/2);
            doc.getElementById("Paper").textContent = text;
        });
    }

    /**************************************/
    saveAsPTI() {
        /* Converts the punch buffer to PTR format, builds a DataURL, and
        constructs a link to cause the URL to be "downloaded" to the local
        device */
        const buf = this.buffer;
        const len = this.bufLength;
        let text = "";

        for (let x=0; x<len; ++x) {
            const code = buf[x];
            text += PaperTapePunch.tapeCodes[code];
            switch (code) {
            case IOCodes.IOCodeReload:
                text += "\n";
                break;
            case IOCodes.IOCodeStop:
                text += "\n\n";
                break;
            }
        }

        if (!text.endsWith("\n")) {     // make sure there's a final new-line
            text += "\n";
        }

        const url = `data:text/plain,${encodeURIComponent(text)}`;
        const hiddenLink = this.doc.createElement("a");
        hiddenLink.setAttribute("download", "retro-g15-Paper-Tape.pti");
        hiddenLink.setAttribute("href", url);
        hiddenLink.click();
    }

    /**************************************/
    saveAsPTR() {
        /* Converts the punch buffer to PTR format, builds a DataURL, and
        constructs a link to cause the URL to be "downloaded" to the local
        device */

        const url = "data:application/octet-stream;base64," +
                    this.btoaUint8(this.buffer, 0, this.bufLength);
        const hiddenLink = this.doc.createElement("a");
        hiddenLink.setAttribute("download", "retro-g15-Paper-Tape.ptr");
        hiddenLink.setAttribute("href", url);
        hiddenLink.click();
    }

    /**************************************/
    saveAsPT() {
        /* Converts the punch buffer to PT format, builds a DataURL, and
        constructs a link to cause the URL to be "downloaded" to the local
        device */
        const buf = this.buffer;
        const len = this.bufLength;
        const image = new Uint8Array(len);

        for (let x=0; x<len; ++x) {     // reverse channel bits in each byte
            image[x] = IOCodes.rev5Bits[buf[x]];
        }

        const url = "data:application/octet-stream;base64," +
                    this.btoaUint8(image, 0, len);
        const hiddenLink = this.doc.createElement("a");
        hiddenLink.setAttribute("download", "retro-g15-Paper-Tape.pt");
        hiddenLink.setAttribute("href", url);
        hiddenLink.click();
    }

    /**************************************/
    menuOpen() {
        /* Opens the PT menu panel and wires up events */

        this.$$("PTMenu").style.display = "block";
        this.$$("PTMenu").addEventListener("click", this.boundMenuClick, false);
    }

    /**************************************/
    menuClose() {
        /* Closes the PT menu panel and disconnects events */

        this.$$("PTMenu").removeEventListener("click", this.boundMenuClick, false);
        this.$$("PTMenu").style.display = "none";
    }

    /**************************************/
    menuClick(ev) {
        /* Event handler for the UNLOAD button. Saves and/or clears the tape buffer */

        switch (ev.target.id) {
        case "PTUnloadBtn":
        case "PTUnloadCaption":
            this.menuOpen();
            break;
        case "PTPunchRunBtn":
            if (this.ready && !this.busy) {
                this.punchLeaderFrames();
            }
            break;
        case "PTSavePTIBtn":
            if (this.ready && !this.busy) {
                this.saveAsPTI();
            }
            break;
        case "PTSavePTBtn":
            if (this.ready && !this.busy) {
                this.saveAsPT();
            }
            break;
        case "PTSavePTRBtn":
            if (this.ready && !this.busy) {
                this.saveAsPTR();
            }
            break;
        case "PTExtractBtn":
            if (this.ready && !this.busy) {
                this.extractTape();
            }
            break;
        case "PTClearBtn":
            this.setPunchEmpty();
            //-no break -- clear always closes panel
        case "PTCloseBtn":
            this.menuClose();
            break;
        }
    }

    /**************************************/
    makeBusy(busy) {
        /* Makes the punch busy (I/O in progress) or not busy (idle) */

        this.busy = busy;
        if (busy) {
            this.canceled = false;
            this.$$("PTCaption").classList.add("active");
        } else {
            this.$$("PTCaption").classList.remove("active");
        }
    }

    /**************************************/
    cancel() {
        /* Cancels the I/O currently in process */

        if (this.busy) {
            this.makeBusy(false);
            this.canceled = true;       // currently affects nothing
        }
    }

    /**************************************/
    write(code) {
        /* Writes one character code to the punch. The physical punch device
        (a standard Flexowriter tape punch unit) could output in excess of 18
        characters per second, but the timing was controlled by the Processor,
        which sent codes to the device at a rate of one every two drum cycles,
        about 17.2 characters per second */
        let char = PaperTapePunch.tapeCodes[code];

        if (this.bufLength < PaperTapePunch.bufferLimit) {
            this.buffer[this.bufLength] = code;
            ++this.bufLength;
            if (code == IOCodes.ioCodeSpace) {
                char = PaperTapePunch.interpunct;
            }

            // Update the tape view control
            let view = this.tapeView.value; // current tape view contents
            if (view.length < PaperTapePunch.viewMax) {
                this.tapeView.value = view + char;
            } else {
                this.tapeView.value = view.slice(1-PaperTapePunch.viewMax) + char;
            }
        }
    }

    /**************************************/
    shutDown() {
        /* Shuts down the device */

        this.$$("PTUnloadBtn").removeEventListener("click", this.boundMenuClick);
        this.$$("PTUnloadCaption").removeEventListener("click", this.boundMenuClick);
    }
} // class PaperTapePunch
