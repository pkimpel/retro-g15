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

    static bufferLimit = 0x40000;       // maximum output that will be buffered (about 4 hours worth)
    static viewMax = 60;                // characters retained in the tape view (originally 90)
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

        this.buffer = "";               // punch output buffer
        this.bufLength = 0;             // current output buffer length (characters)
        this.tapeView.value = "";
    }

    /**************************************/
    extractTape() {
        /* Copies the text contents of the "paper" area of the device, opens a new
        temporary window, and pastes that text into the window so it can be copied
        or saved by the user */
        var title = "retro-g15 Paper Tape Punch Output";

        openPopup(this.window, "./FramePaper.html", "",
                "scrollbars,resizable,width=500,height=500",
                this, (ev) => {
            let doc = ev.target;
            let win = doc.defaultView;

            doc.title = title;
            win.moveTo((screen.availWidth-win.outerWidth)/2, (screen.availHeight-win.outerHeight)/2);
            doc.getElementById("Paper").textContent = this.buffer;
        });
    }

    /**************************************/
    saveTape() {
        /* Extracts the text of the punch output area, converts it to a
        DataURL, and constructs a link to cause the URL to be "downloaded" and
        stored on the local device */
        let text = this.buffer;

        if (text[text.length-1] != "\n") {      // make sure there's a final new-line
            text = text & "\n";
        }

        const url = `data:text/plain,${encodeURIComponent(text)}`;
        const hiddenLink = this.doc.createElement("a");

        hiddenLink.setAttribute("download", "retro-g15-Paper-Tape.txt");
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
        case "PTExtractBtn":
            this.extractTape();
            break;
        case "PTSaveBtn":
            if (this.ready && !this.busy) {
                this.saveTape();
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
            this.buffer += char;
            ++this.bufLength;
            switch (code) {
            case IOCodes.ioCodeReload:
                this.buffer += "\n";
                break;
            case IOCodes.ioCodeStop:
                this.buffer += "\n\n";
                break;
            case IOCodes.ioCodeSpace:
                char = PaperTapePunch.interpunct;
                break;
            }

            // Update the tape view control
            let view = this.tapeView.value; // current tape view contents
            let viewLength = view.length;   // current tape view length
            if (viewLength < PaperTapePunch.viewMax) {
                this.tapeView.value = view + char;
                ++viewLength;
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
