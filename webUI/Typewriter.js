/***********************************************************************
* retro-g15/webUI Typewriter.js
************************************************************************
* Copyright (c) 2022, Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* Bendix G-15 typewriter device.
*
* Defines the typewriter keyboard and printer device.
*
************************************************************************
* 2022-03-24  P.Kimpel
*   Original version, from retro-g15 PhotoTapePunch.js and ControlPanel.js.
***********************************************************************/

export {Typewriter};

import * as Util from "../emulator/Util.js";
import * as IOCodes from "../emulator/IOCodes.js";
import {openPopup} from "./PopupUtil.js";

class Typewriter {

    static cursorChar = "_";            // end-of-line cursor indicator
    static invKeyChar = "\u2592";       // flashed to indicate invalid key press
    static pillowChar = "\u2588";       // EOL overprint character
    static invKeyFlashTime = 150;       // keyboard lock flash time, ms
    static maxScrollLines = 10000;      // max lines retained in "paper" area
    static maxCols = 132;               // maximum number of columns per line
    static defaultInputRate = 8.6;      // default max typing rate (used by Type-O-Matic)

    static commentRex = /#[^\x0D\x0A]*/g;
    static newLineRex = /[\x0D\x0A\x0C]+/g;

    static printCodes = [
        " ", "-", "\n", "\t", "$", "!", ".", "~", " ", "-", "\n", "\t", "$", "!", ".", "~",
        "0", "1",  "2",  "3", "4", "5", "6", "7", "8", "9",  "u",  "v", "w", "x", "y", "z"];

    constructor(context) {
        /* Initializes and wires up events for the console typewriter device.
        "context" is an object passing other objects and callback functions from
        the global script:
            $$() returns an object reference from its id value
            processor is the Processor object
            window is the ControlPanel window
        */
        const $$ = this.$$ = context.$$;
        this.processor = context.processor;
        this.window = context.window;
        this.doc = this.window.document;
        this.platen = this.$$("TypewriterPaper");
        this.paperDoc = this.platen.contentDocument;
        this.paperDoc.title = this.doc.title + " Paper";
        this.paper = this.paperDoc.getElementById("Paper");
        this.readEnabled = false;       // true when a TYPE IN is active
        this.tabStop = [6,11,16,21,26,31,36,41,46,51,56,61,66,71,76,81,86,
                        91,96,101,106,111,116,121,126];
        this.timer = new Util.Timer();

        this.boundMenuClick = this.menuClick.bind(this);
        this.boundPanelKeydown = this.panelKeydown.bind(this);
        this.boundPanelKeyup = this.panelKeyup.bind(this);
        this.boundPanelPaste = this.panelPaste.bind(this);
        this.boundTOMPanelClick = this.tomPanelClick.bind(this);

        // Keyboard Type-O-Matic buffer controls
        this.tomBuffer = "";            // Type-O-Matic keystroke buffer
        this.tomPaused = false;         // true if Type-O-Matic is currently suspended
        this.tomIndex = 0;              // current offset into the Type-O-Matic buffer
        this.tomLength = 0;             // current length of the Type-O-Matic text
        this.tomMeter = $$("TypeOMaticMeterBar");

        this.clear();
        this.closeTypeOMaticPanel();

        $$("FrontPanel").addEventListener("keydown", this.boundPanelKeydown, false);
        $$("FrontPanel").addEventListener("keyup", this.boundPanelKeyup, false);
        $$("FrontPanel").addEventListener("paste", this.boundPanelPaste, true);
        this.paperDoc.addEventListener("keydown", this.boundPanelKeydown, false);
        this.paperDoc.addEventListener("keyup", this.boundPanelKeyup, false);
        this.paperDoc.addEventListener("paste", this.boundPanelPaste, true);
        $$("TypewriterMenuIcon").addEventListener("click", this.boundMenuClick, false);
        $$("TypeOMaticPanel").addEventListener("click", this.boundTOMPanelClick, false);

    }

    /**************************************/
    clear() {
        /* Initializes (and if necessary, creates) the typewriter unit state */

        this.busy = false;              // typewriter is busy with input
        this.ready = true;              // typewriter is ready for output
        this.printerLine = 0;
        this.printerCol = 0;

        this.setPaperEmpty();
    }

    /**************************************/
    cancel() {
        /* Cancels any TypeIn I/O currently in process */

        this.busy = false;
        this.readEnabled = false;
        this.processor.cancelTypeIn();
    }


    /*******************************************************************
    *  Typewriter Input                                                *
    *******************************************************************/

    /**************************************/
    flashInvalidKey() {
        /* Temporarily flashes the cursor character to indicate the keyboard
        is locked */
        const paper = this.paper;

        paper.lastChild.nodeValue =
                paper.lastChild.nodeValue.slice(0, -1) + Typewriter.invKeyChar;
        setTimeout(() => {
            paper.lastChild.nodeValue =
                    paper.lastChild.nodeValue.slice(0, -1) + Typewriter.cursorChar;
        }, Typewriter.invKeyFlashTime);
    }

    /**************************************/
    async processKeystroke(key) {
        /* Handles keystrokes from the keyboard and Type-O-Matic buffer.
        Processes data input from the keyboard, Enable switch command codes,
        and Escape (for toggling the Enable switch). Returns:
            0 if the keystroke was accepted by the processor
            1 if the keystroke was a STOP or refused by the processor
            2 if the keystroke was invalid */
        const p = this.processor;       // local copy of Processor reference
        let result = 0;                 // assume it's a valid keystroke

        if (this.busy) {
            this.flashInvalidKey();     // typing too fast -- discard keystroke
            return 2;
        }

        this.busy = true;
        switch (key) {
        case "-": case "/":
        case "0": case "1": case "2": case "3": case "4":
        case "5": case "6": case "7": case "8": case "9":
        case "S": case "s":
        case "U": case "V": case "W": case "X": case "Y": case "Z":
        case "u": case "v": case "w": case "x": case "y": case "z":
            this.printChar(key);
            result = await p.receiveKeyboardCode(IOCodes.ioCodeFilter[key.charCodeAt(0) & 0x7F]);
            break;
        case "A": case "a":
        case "B": case "b":
        case "C": case "c":
        case "F": case "f":
        case "I": case "i":
        case "M": case "m":
        case "P": case "p":
        case "Q": case "q":
        case "R": case "r":
        case "T": case "t":
            this.printChar(key);
            result = await p.receiveKeyboardCode(-(key.charCodeAt(0) & 0x7F));
            break;
        case "Enter":
            this.printNewLine();
            result = await p.receiveKeyboardCode(IOCodes.ioCodeCR);
            break;
        case "Tab":
            this.printTab();
            result = await p.receiveKeyboardCode(IOCodes.ioCodeTab);
            break;
        case " ":
        case ".":
            this.printChar(key);
            break;                      // just eat spaces and periods, but consider them valid
        default:
            result = 2;                 // invalid keystroke
            break;
        }

        this.busy = false;
        if (result) {
            this.flashInvalidKey();
        }

        return result;
    }

    /**************************************/
    async panelKeydown(ev) {
        /* Handles the keydown event from FrontPanel. If it's an Escape,
        Backspace or a valid G-15 keystroke, then consume it here. If not,
        then check if it's from the standard or numpad sections of the keyboard.
        If so and its "key" value is a single character, print it but otherwise
        discard that keystroke. In all other cases, simply pass along the
        keystroke to the next higher level for its default action */

        if (ev.ctrlKey || ev.altKey || ev.metaKey) {
            this.flashInvalidKey();     // ignore this keystroke, allow default action
        } else {
            const key = ev.key;
            switch (key) {
            case "Escape":
                ev.preventDefault();
                ev.stopPropagation();
                if (!ev.repeating) {
                    this.processor.enableSwitchChange(1);
                    this.$$("EnableSwitchOff").checked = false;
                    this.$$("EnableSwitchOn").checked = true;
                }
                break;
            case "Tab":                 // special handling for Firefox 147.0.2 and later
            case "/":
                ev.preventDefault();
                ev.stopPropagation();
                if (await this.processKeystroke(ev.key) == 1) {
                    this.readEnabled = false;
                }
            case "Backspace":
                ev.preventDefault();
                ev.stopPropagation();
                break;
            default:
                const result = await this.processKeystroke(ev.key);
                switch (result) {
                case 0:                 // valid keystroke
                    ev.preventDefault();
                    ev.stopPropagation();
                    break;
                case 1:                 // STOP or refused by processor
                    this.readEnabled = false;
                    ev.preventDefault();
                    ev.stopPropagation();
                    break;
                default:                // invalid keystroke
                    switch (ev.location) {
                    case KeyboardEvent.DOM_KEY_LOCATION_STANDARD:
                    case KeyboardEvent.DOM_KEY_LOCATION_NUMPAD:
                        if (key.length == 1) {
                            ev.preventDefault();
                            ev.stopPropagation();
                            this.printChar(key);
                        }
                        break;
                    default:
                        // Otherwise, pass along for default action.
                        break;
                    }
                    break;
                }
            }
        }
    }

    /**************************************/
    panelKeyup(ev) {
        /* Handles the keyup event from FrontPanel */
        let p = this.processor;         // local copy of Processor reference

        switch (ev.key) {
        case "Escape":
            ev.preventDefault();
            ev.stopPropagation();
            p.enableSwitchChange(0);
            this.$$("EnableSwitchOff").checked = true;
            this.$$("EnableSwitchOn").checked = false;
            break;
        }
    }

    /**************************************/
    openTypeOMaticPanel() {
        /* Opens the Type-O-Matic panel */

        this.$$("TypeOMaticPanel").style.display = "block";
    }

    /**************************************/
    closeTypeOMaticPanel() {
        /* Closes the Type-O-Matic panel */

        this.$$("TypeOMaticPanel").style.display = "none";
    }

    /**************************************/
    async enableTypeOMatic() {
        /* Handles submission of virtual keystrokes from the Type-O-Matic buffer */
        let typing = this.tomIndex < this.tomLength && !this.tomPaused;

        if (!typing) {
            return;
        }

        const tomPeriod = 1000/Math.min(Typewriter.defaultInputRate*Util.timingFactor, 2500); // ms
        let nextKeystrokeStamp = performance.now();
        this.openTypeOMaticPanel();

        do {
            let key = this.tomBuffer[this.tomIndex];
            switch (key) {
            case "t":
                key = "Tab";
                break;
            case "c":
                key = "Enter";
                break;
            }

            const result = await this.processKeystroke(key);
            switch (result) {
            case 0:                     // keystroke consumed
            case 2:                     // invalid keystroke
                nextKeystrokeStamp += tomPeriod;
                await this.timer.delayUntil(nextKeystrokeStamp);
                break;
            case 1:                     // STOP or refused by processor
                typing = false;
                this.readEnabled = false;
                break;
            default:                    // invalid result (should never happen)
                throw new Error(`Invalid processKeystroke result: ${result}`);
                typing = false;
                break;
            }

            ++this.tomIndex;
            this.tomMeter.value = this.tomLength - this.tomIndex;
            if (this.tomIndex >= this.tomLength) {
                typing = false;
                this.closeTypeOMaticPanel()
            } else if (this.tomPaused) {
                typing = false;
            }
        } while (typing);
    }

    /**************************************/
    stripComments(buf) {
        /* Strips "#" comments from a text buffer, returning a new buffer */

        return buf.replace(Typewriter.commentRex, "")
                  .replace(Typewriter.newLineRex, "")
                  .toLowerCase();
    }

    /**************************************/
    panelPaste(ev) {
        /* Event handler for pasting into the FrontPanel. Appends the paste
        text to this.tomBuffer and opens the Type-O-Matic panel if needed */
        const text = (ev.clipboardData || window.clipboardData).getData("text");

        ev.preventDefault();
        ev.stopPropagation();

        if (this.tomIndex >= this.tomLength) {
            this.tomBuffer = this.stripComments(text);
        } else {
            this.tomBuffer = this.tomBuffer.substring(this.tomIndex) + this.stripComments(text);
        }

        this.tomIndex = 0;
        this.tomLength = this.tomBuffer.length;
        this.tomMeter.value = this.tomLength;
        this.tomMeter.max = this.tomLength;
        this.openTypeOMaticPanel();
        if (this.readEnabled) {
            this.enableTypeOMatic();
        }
    }

    /**************************************/
    tomPanelClick(ev) {
        /* Event handler for clicks in the Type-O-Matic panel */

        switch (ev.target.id) {
        case "TypeOMaticPauseBtn":
            this.tomPaused = !this.tomPaused;
            if (this.tomPaused) {
                this.$$("TypeOMaticPauseBtn").textContent = "Resume";
                this.$$("TypeOMaticPauseBtn").classList.add("paused");
            } else {
                this.$$("TypeOMaticPauseBtn").textContent = "Pause";
                this.$$("TypeOMaticPauseBtn").classList.remove("paused");
                this.enableTypeOMatic();
            }
            break;
        case "TypeOMaticClearBtn":
            this.tomIndex = this.tomLength = 0;
            this.tomBuffer = "";
            this.tomPaused = false;
            this.$$("TypeOMaticPauseBtn").textContent = "Pause";
            this.$$("TypeOMaticPauseBtn").classList.remove("paused");
            this.closeTypeOMaticPanel();
            break;
        }
    }

    /**************************************/
    read() {
        /* Called by Processor when a TYPE IN command is initiated. If the
        Type-O-Matic buffer is active, initiates the sending of virtual
        keystrokes from the Type-O-Matic buffer */

        this.readEnabled = true;
        if (this.tomIndex < this.tomLength && !this.tomPaused) {
            this.enableTypeOMatic();
        }
    }


    /*******************************************************************
    *  Typewriter Output                                               *
    *******************************************************************/

    /**************************************/
    setPaperEmpty() {
        /* Empties the printer output "paper" and initializes it for new output */

        this.paper.textContent = "";

        this.paper.appendChild(this.doc.createTextNode(""));
        this.printerLine = 0;
        this.printerCol = 0;
        this.paper.scrollTop = this.paper.scrollHeight; // scroll to end
    }

    /**************************************/
    printNewLine() {
        /* Appends a newline to the current text node, and then a new text
        node to the end of the <pre> element within the paper element */
        let paper = this.paper;
        let line = paper.lastChild.nodeValue;

        while (paper.childNodes.length > Typewriter.maxScrollLines) {
            paper.removeChild(paper.firstChild);
        }

        paper.lastChild.nodeValue = line.substring(0, line.length-1) + "\n";
        paper.appendChild(this.doc.createTextNode(Typewriter.cursorChar));
        ++this.printerLine;
        this.printerCol = 0;
        paper.scrollIntoView(false);
    }

    /**************************************/
    printChar(char) {
    /* Outputs the ANSI character "char" to the device */
        let line = this.paper.lastChild.nodeValue;
        let len = line.length;

        if (len < 1) {                  // first char on line
            this.paper.lastChild.nodeValue = `${char}${Typewriter.cursorChar}`;
            this.printerCol = 1;
            this.paper.scrollTop = this.paper.scrollHeight;     // scroll line into view
        } else if (len < Typewriter.maxCols) {  // normal char
            this.paper.lastChild.nodeValue =
                    `${line.substring(0, len-1)}${char}${Typewriter.cursorChar}`;
            ++this.printerCol;
        } else {                        // right margin overflow -- overprint last col
            this.paper.lastChild.nodeValue =
                    `${line.substring(0, Typewriter.maxCols-1)}${Typewriter.pillowChar}${Typewriter.cursorChar}`;
        }
    }

    /**************************************/
    printTab() {
        /* Simulates tabulation by inserting an appropriate number of spaces */
        let tabCol = Typewriter.maxCols-1;      // tabulation column (defaults to end of carriage)

        for (let x=0; x<this.tabStop.length; ++x) {
            if (this.tabStop[x] > this.printerCol) {
                tabCol = Math.min(this.tabStop[x], tabCol);
                break; // out of for loop
            }
        } // for x

        while (this.printerCol < tabCol) {
            this.printChar(" ");        // output a space
        }
    }

    /**************************************/
    write(code) {
        /* Writes one character code to the typewriter. The physical typewriter
        device could print in excess of 8 characters per second, but the timing
        was controlled by the Processor, which sent codes to the device at a
        rate of one every four drum cycles, about 8.6 characters per second */

        switch (code) {
        case IOCodes.ioCodeCR:
            this.printNewLine();
            break;
        case IOCodes.ioCodeTab:
            this.printTab();
            break;
        case IOCodes.ioCodeReload:
        case IOCodes.ioCodeStop:
        case IOCodes.ioCodeWait:
            // ignored by the typewriter
            break;
        default:
            /***** TEMP to provide automatic newline on line overflow - TEMP TEMP TEMP TEMP *****/
            //if (this.printerCol >= Typewriter.maxCols) {
            //    this.printNewLine();
            //}
            /****** end TEMP *****/

            this.printChar(Typewriter.printCodes[code]);
            break;
        }
    }

    /**************************************/
    extractPaper(ev) {
        /* Copies the text contents of the "paper" area of the device, opens a new
        temporary window, and pastes that text into the window so it can be copied
        or saved by the user */
        let text = this.paper.textContent;
        let title = "retro-g15 Typewriter Output";

        openPopup(this.window, "./FramePaper.html", "",
                "scrollbars,resizable,width=500,height=500",
                this, (ev) => {
            let doc = ev.target;
            let win = doc.defaultView;

            doc.title = title;
            win.moveTo((screen.availWidth-win.outerWidth)/2, (screen.availHeight-win.outerHeight)/2);
            doc.getElementById("Paper").textContent = text;
        });
    }

    /**************************************/
    savePaper() {
        /* Extracts the text of the typewriter paper area, converts it to a
        DataURL, and constructs a link to cause the URL to be "downloaded" and
        stored on the local device */
        let text = this.paper.textContent;

        if (text[text.length-1] == "_") {       // strip the cursor character
            text = text.slice(0, -1);
        }

        if (text[text.length-1] != "\n") {      // make sure there's a final new-line
            text = text + "\n";
        }

        const url = `data:text/plain,${encodeURIComponent(text)}`;
        const hiddenLink = this.doc.createElement("a");

        hiddenLink.setAttribute("download", "retro-g15-Typewriter-Paper.txt");
        hiddenLink.setAttribute("href", url);
        hiddenLink.click();
    }

    /**************************************/
    menuOpen() {
        /* Opens the Typewriter menu panel and wires up events */

        this.$$("TypewriterMenu").style.display = "block";
        this.$$("TypewriterMenu").addEventListener("click", this.boundMenuClick, false);
    }

    /**************************************/
    menuClose() {
        /* Closes the Typewriter menu panel and disconnects events */

        this.$$("TypewriterMenu").removeEventListener("click", this.boundMenuClick, false);
        this.$$("TypewriterMenu").style.display = "none";
    }

    /**************************************/
    menuClick(ev) {
        /* Handles click for the menu icon and menu panel */

        switch (ev.target.id) {
        case "TypewriterMenuIcon":
            this.menuOpen();
            break;
        case "TypewriterExtractBtn":
            if (this.ready) {
                this.extractPaper();
            }
            break;
        case "TypewriterPrintBtn":
            if (this.ready) {
                this.platen.contentWindow.print();
            }
            break;
        case "TypewriterSaveBtn":
            this.savePaper();
            break;
        case "TypewriterClearBtn":
            this.setPaperEmpty();
            //-no break -- clear always closes panel
        case "TypewriterCloseBtn":
            this.menuClose();
            break;
        }
    }

    /**************************************/
    shutDown() {
        /* Shuts down the device */

        this.closeTypeOMaticPanel();
        this.$$("FrontPanel").removeEventListener("keydown", this.boundPanelKeydown, false);
        this.$$("FrontPanel").removeEventListener("keyup", this.boundPanelKeyup, false);
        this.paperDoc.removeEventListener("keydown", this.boundPanelKeydown, false);
        this.paperDoc.removeEventListener("keyup", this.boundPanelKeyup, false);
        this.$$("TypewriterMenuIcon").removeEventListener("click", this.boundMenuClick, false);
    }
} // class Typewriter
