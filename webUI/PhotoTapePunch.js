/***********************************************************************
* retro-g15/webUI PhotoTapePunch.js
************************************************************************
* Copyright (c) 2022, Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* Bendix G-15 photo (paper) tape punch.
*
* Defines the paper tape output device.
*
************************************************************************
* 2022-03-24  P.Kimpel
*   Original version, from retro-205 D205ConsoleInput.js.
***********************************************************************/

export {PhotoTapePunch};

import * as Util from "../emulator/Util.js";
import * as IOCodes from "../emulator/IOCodes.js";
import {openPopup} from "./PopupUtil.js";

class PhotoTapePunch {

    constructor(context) {
        /* Initializes and wires up events for the Photo Tape punch.
        "context" is an object passing other objects and callback functions from
        the global script:
            $$() returns an object reference from its id value
            processor is the Processor object
            window is the ControlPanel window
        */
        let $$ = this.$$ = context.$$;
        this.processor = context.processor;
        this.window = context.window;
        this.tapeView = $$("PunchTapeView");
        this.boundUnloadButtonClick = this.unloadButtonClick.bind(this);

        this.clear();

        $$("PunchTapeUnloadBtn").addEventListener("click", this.boundUnloadButtonClick);
    }

    /**************************************/
    clear() {
        /* Initializes (and if necessary, creates) the punch unit state */

        this.ready = true;              // punch is ready for output
        this.busy = false;              // an I/O is in progress
        this.canceled = false;          // current I/O canceled

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
    punchCopyTape() {
        /* Copies the text contents of the "paper" area of the device, opens a new
        temporary window, and pastes that text into the window so it can be copied
        or saved by the user */
        var title = "retro-g15 Photo Tape Punch Output";

        openPopup(this.window, "./FramePaper.html", "",
                "scrollbars,resizable,width=500,height=500",
                this, function(ev) {
            let doc = ev.target;
            let win = doc.defaultView;

            doc.title = title;
            win.moveTo((screen.availWidth-win.outerWidth)/2, (screen.availHeight-win.outerHeight)/2);
            doc.getElementById("Paper").textContent = this.buffer;
            this.setPunchEmpty();
        });
    }

    /**************************************/
    unloadButtonClick(ev) {
        /* Clears the internal tape buffer in response to the UNLOAD button */

        if (this.ready && !this.busy) {
            this.punchCopyTape();
            ev.preventDefault();
            ev.stopPropagation();
        }
    }

    /**************************************/
    cancel() {
        /* Cancels the I/O currently in process */

        if (this.ready) {
            this.canceled = true;       // currently affects nothing
        }
    }

    /**************************************/
    write(code) {
        /* Writes one character code to the punch. The physical punch device
        (a standard Flexowriter tape punch unit) could output in excess of 17
        characters per second, but the timing was controlled by the processor,
        which sent codes to the device at a rate of one every two drum cycles,
        about 17.2 characters per second */
        const viewMax = 90;             // characters retained in the tape view
        let char = PhotoTapePunch.tapeCodes[code];

        if (this.bufLength < PhotoTapePunch.bufferLimit) {
            this.buffer += char;
            ++this.bufLength;
            switch (code) {
            case IOCodes.ioCodeReload:
                this.buffer += "\n";
                break;
            case IOCodes.ioCodeStop:
                this.buffer += "\n\n";
                break;
            }

            // Update the tape view control
            let view = this.tapeView.value; // current tape view contents
            let viewLength = view.length;   // current tape view length
            if (viewLength < viewMax) {
                this.tapeView.value = view + char;
                ++viewLength;
            } else {
                this.tapeView.value = view.substring(viewLength-(viewMax-1)) + char;
            }

            this.tapeView.setSelectionRange(viewLength-1, viewLength);
        }
    }

    /**************************************/
    shutDown() {
        /* Shuts down the device */

        this.$$("PRUnloadBtn").removeEventListener("click", this.boundUnloadButtonClick);
    }
}


// Static properties

PhotoTapePunch.bufferLimit = 0x40000;   // maximum output that will be buffered (about 4 hours worth)
PhotoTapePunch.tapeCodes = [
    " ", "-", "C", "T", "S", "/", ".", "~", " ", "-", "C", "T", "S", "/", ".", "~",
    "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "u", "v", "w", "x", "y", "z"];
