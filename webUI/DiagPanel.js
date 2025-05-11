/***********************************************************************
* retro-g15/webUI DiagPanel.js
************************************************************************
* Copyright (c) 2021, Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* Bendix G-15 emulator support class for the diagnostic panel.
************************************************************************
* 2021-12-31  P.Kimpel
*   Original version, extracted from ControlPanel.js.
***********************************************************************/

export {DiagPanel};

import * as Util from "../emulator/Util.js";
import {DiagRegister} from "./DiagRegister.js";
import {DiagLamp} from "./DiagLamp.js";
import {openPopup} from "./PopupUtil.js";
import {Processor} from "../emulator/Processor.js";

class DiagPanel {

    static displayRefreshPeriod = 50;   // ms

    /**************************************/
    constructor(context) {
        /* Constructs the G15 diagnostic panel controls and wires up their events.
        "context" is an object passing other objects and callback functions from
        the global script:
            closeDiagPanel() shuts down this panel
            processor is the Processor object
        */
        const w = 740;
        const h = 600;

        this.context = context;
        this.intervalToken = 0;         // interval timer cancel token
        this.bpSetLoc = null;           // drum location of BPSet word
        this.boundUpdatePanel = this.updatePanel.bind(this);
        this.boundFocusHandler = this.focusHandler.bind(this);
        this.boundShutDown = this.shutDown.bind(this);
        this.boundDumpLine = this.dumpLine.bind(this);
        this.boundBPSetChange = this.bpSetChange.bind(this);
        this.boundProcStep = context.processor.step.bind(this.context.processor);
        this.boundProcBP = (ev) => {
            this.context.controlPanel.setComputeSwitch(2);
        };
         this.boundProcGo = (ev) => {
            this.context.controlPanel.setComputeSwitch(1);
        };
       this.boundProcStop = (ev) => {
            this.context.controlPanel.setComputeSwitch(0);
        };

        // Create the panel window
        this.doc = null;
        this.window = null;
        openPopup(context.window, "./DiagPanel.html", "DiagPanel",
                "location=no,scrollbars=no,resizable,width=" + w + ",height=" + h +
                    ",top=16,left=16",
                this, this.diagPanelOnLoad);
    }

    get closed() {
        return (this.window ? this.window.closed : true);
    }

    /**************************************/
    $$(id) {
        /* Returns a DOM object based on its "id" property */

        return this.doc.getElementById(id);
    }

    /**************************************/
    focusHandler(ev) {
        /* Handles focus events for the entire BODY. Determines action to take
        for specific elements */
        const target = ev.target;

        switch (target.id) {
        case "LineNr":
        case "BPSetLine":
        case "BPSetWord":
            setTimeout(() => {          // allow any click to be handled first
                target.select();
                ev.stopPropagation();
            }, 100);
            break;
        }
    }

    /**************************************/
    dumpLine() {
        /* Dumps the currently-specified line to the LineDump <pre> in signed hex */
        let text = this.$$("LineNr").value.trim().toUpperCase();
        let lineNr = (text == "MZ" ? 32 : parseInt(text, 10) || 0);

        switch (true) {
        case lineNr >= 0 && lineNr < 24:
        case lineNr == 32:              // MZ (hidden)
            let drum = this.context.processor.drum;
            let top = (lineNr < 20 ? Util.longLineSize : Util.fastLineSize);
            let inc = (lineNr < 20 ? 12 : Util.fastLineSize);
            let text = "";

            for (let x=0; x<top; x+=inc) {
                text += x.toString().padStart(3, " ");
                for (let y=0; y<inc; ++y) {
                    let word = drum.line[lineNr][x+y];
                    text += ` ${Util.g15SignedHex(word)}`;
                }

                text += "\n";
            }

            this.$$("LineDump").textContent = text;
        }
    }

    /**************************************/
    dumpFastLine(lineNr) {
        /* Dumps the currently-specified fast (4-word) line to its text
        area in signed hex */
        let drum = this.context.processor.drum;
        let id = `Line${(lineNr == 32 ? "MZ" : lineNr.toString())}Dump`;
        let text = "";

        for (let x=0; x<Util.fastLineSize; ++x) {
            let word = drum.line[lineNr][x];
            text += ` ${Util.g15SignedHex(word)}`;
        }

        this.$$(id).textContent = text;
    }

    /**************************************/
    formatCommandLoc(cd, loc) {
        /* Formats a drum location from a CD register value and a word number */

        return `${Util.lineHex[Processor.CDXlate[cd]]}.${Util.lineHex[loc]}`;

    }

    /**************************************/
    disassembleCommand(cmd) {
        /* Disassembles an instruction word, returning a string in a PPR-like format */

        return Util.disassembleCommand(cmd).replace(" ", "\xA0");
    }

    /**************************************/
    bpSetChange(ev) {
        /* Handler for click and change events in BPSetDiv. Disassembles the
        designated drum word and toggles the word's BP bit */
        const target = ev.target;

        switch (ev.type) {
        case "click":
            switch (target.id) {
            case "BPSetCheck":
                if (this.bpSetLoc) {
                    const line = this.context.processor.drum.line[this.bpSetLoc.line];
                    line[this.bpSetLoc.word] = (line[this.bpSetLoc.word] & ~(1 << 20)) |
                                               ((target.checked ? 1 : 0) << 20);
                }
                ev.stopPropagation();
                break;
            }
            break;
        case "change":
            switch (target.id) {
            case "BPSetLine":
            case "BPSetWord":
                const lineBox = this.$$("BPSetLine");
                const wordBox = this.$$("BPSetWord");
                const bpCheck = this.$$("BPSetCheck");
                let lineText = lineBox.value.trim();
                let wordText = wordBox.value.trim().toLowerCase();
                if (lineText.length == 0 || wordText.length == 0) {
                    this.$$("BPSetDisasm").textContent = "\xA0";
                    bpCheck.disabled = true;
                    this.bpSetLoc = null;       // BP location not set
                    return;
                } else {
                    let lineLoc = Math.min(Math.abs(parseInt(lineText, 10) || 0), 23);
                    let wordLoc = 0;
                    if (wordText.length == 2 && wordText.startsWith("u")) {
                        wordLoc = Math.abs((parseInt(wordText.substring(1), 10) || 0)) + 100;
                    } else {
                        wordLoc = Math.abs(parseInt(wordText, 10) || 0);
                    }

                    wordLoc %= lineLoc < 20 ? Util.longLineSize : Util.fastLineSize;
                    this.bpSetLoc = {line: lineLoc, word: wordLoc};
                    lineBox.value = lineLoc;
                    wordBox.value = wordLoc;
                    bpCheck.disabled = false;
                }
                ev.stopPropagation();
                break;
            }
            break;
        }
    }

    /**************************************/
    updatePanel() {
        /* Updates the panel registers and flip-flops from processor state */
        const p = this.context.processor;       // local copy of Processor reference
        const drum = p.drum;                    // local copy of Drum reference
        const now = performance.now();

        let rt = drum.runTime;
        while (rt < 0) {
            rt += now;
        }

        let wt = drum.wordTimeCount.toString();
        for (let x=wt.length-3; x>0; x-=3) {
            wt = `${wt.substring(0, x)},${wt.substring(x)}`;
        }

        this.runTime.textContent = (rt/1000).toFixed(2);
        this.wordTimes.textContent = wt;

        this.drumLoc.updateFromRegister(drum.L);
        this.CDReg.updateFromRegister(p.CD);
        this.cmdLoc.updateFromRegister(p.cmdLoc);
        this.RCLamp.updateFromFlipFlop(p.RC);
        this.TRLamp.updateFromFlipFlop(p.TR);
        this.CHLamp.updateFromFlipFlop(p.CH);
        this.CGLamp.updateFromFlipFlop(p.CG);
        this.CQLamp.updateFromFlipFlop(p.CQ);
        this.CSLamp.updateFromFlipFlop(p.CS);
        this.FOLamp.updateFromFlipFlop(p.FO);

        this.cmdDisasmBox.textContent =
            `${this.formatCommandLoc(p.CD.value, p.cmdLoc.value)}:\xA0${this.disassembleCommand(p.cmdWord)}`;
        this.DILamp.updateFromFlipFlop(p.DI);
        this.TReg.updateFromRegister(p.T);
        this.BPLamp.updateFromFlipFlop(p.BP);
        this.NReg.updateFromRegister(p.N);
        this.CReg.updateFromRegister(p.C);
        this.SReg.updateFromRegister(p.S);
        this.DReg.updateFromRegister(p.D);
        this.C1Lamp.updateFromFlipFlop(p.C1);

        this.ARReg.updateFromRegister(drum.AR);
        this.IPLamp.updateFromFlipFlop(p.IP);

        this.ID1Reg.updateFromRegister(drum.ID[1]);
        this.ID0Reg.updateFromRegister(drum.ID[0]);

        this.MQ1Reg.updateFromRegister(drum.MQ[1]);
        this.MQ0Reg.updateFromRegister(drum.MQ[0]);

        this.PN1Reg.updateFromRegister(drum.PN[1]);
        this.PN0Reg.updateFromRegister(drum.PN[0]);

        if (Math.trunc(now/250) % 2) {
            this.dumpLine();
            this.dumpFastLine(20);
            this.dumpFastLine(21);
            this.dumpFastLine(22);
            this.dumpFastLine(23);
            this.dumpFastLine(32);      // MZ
        }

        if (this.bpSetLoc) {
            const word = drum.line[this.bpSetLoc.line][this.bpSetLoc.word];
            this.$$("BPSetDisasm").textContent = this.disassembleCommand(word);
            this.$$("BPSetCheck").checked = (word >> 20) & 1;
        }
    }

    /**************************************/
    diagPanelOnLoad(ev) {
        /* Event handler for the window's onload event */
        let e = null;                   // temp element reference

        this.doc = ev.target;
        this.window = this.doc.defaultView;
        this.panel = this.$$("DiagPanel");
        this.runTime = this.$$("RunTime");
        this.wordTimes = this.$$("WordTimes");

        this.drumLoc = new DiagRegister(this.$$("DrumLocBox"), 7, false, 0b0000, "DrumL_", "Drum L");
        this.CDReg = new DiagRegister(this.$$("CDBox"), 3, false, 0b0100, "CDReg_", "CD");
        this.cmdLoc = new DiagRegister(this.$$("CmdLocBox"), 7, false, 0b0000, "CmdL_", "Cmd L");
        this.RCLamp = new DiagLamp(this.$$("RCBox"), 4, 2, "RCLamp");
        this.RCLamp.setCaption("RC");
        this.TRLamp = new DiagLamp(this.$$("TRBox"), 4, 2, "TRLamp");
        this.TRLamp.setCaption("TR");
        this.CHLamp = new DiagLamp(this.$$("CHBox"), 4, 2, "CHLamp");
        this.CHLamp.setCaption("CH");
        this.CGLamp = new DiagLamp(this.$$("CGBox"), 4, 2, "CGLamp");
        this.CGLamp.setCaption("CG");
        this.CQLamp = new DiagLamp(this.$$("CQBox"), 4, 2, "CQLamp");
        this.CQLamp.setCaption("CQ");
        this.CSLamp = new DiagLamp(this.$$("CSBox"), 4, 2, "CSLamp");
        this.CSLamp.setCaption("CS");
        this.FOLamp = new DiagLamp(this.$$("FOBox"), 4, 2, "FOLamp");
        this.FOLamp.setCaption("FO");

        this.cmdDisasmBox = this.$$("CmdDisasmBox");
        this.DILamp = new DiagLamp(this.$$("DIBox"), 4, 2, "IDLamp");
        this.DILamp.setCaption("I/D");
        this.TReg = new DiagRegister(this.$$("TBox"), 7, false, 0b0000, "TReg_", "T");
        this.BPLamp = new DiagLamp(this.$$("BPBox"), 4, 2, "BPLamp");
        this.BPLamp.setCaption("BP");
        this.NReg = new DiagRegister(this.$$("NBox"), 7, false, 0b0000, "NReg_", "N");
        this.CReg = new DiagRegister(this.$$("CBox"), 2, false, 0b0100, "CReg_", "C");
        this.SReg = new DiagRegister(this.$$("SBox"), 5, false, 0b0000, "SReg_", "S");
        this.DReg = new DiagRegister(this.$$("DBox"), 5, false, 0b0000, "DReg_", "D");
        this.C1Lamp = new DiagLamp(this.$$("C1Box"), 4, 2, "SDLamp");
        this.C1Lamp.setCaption("S/D");

        this.ARReg = new DiagRegister(this.$$("ARBox"), Util.wordBits, true, 0b0111, "ARReg_", "AR");
        this.IPLamp = new DiagLamp(this.$$("IPBox"), 4, 2, "IPLamp");
        this.IPLamp.setCaption("IP");

        this.ID1Reg = new DiagRegister(this.$$("ID1Box"), Util.wordBits, true, 0b1110, "ID1Reg_", "ID.1");
        this.ID0Reg = new DiagRegister(this.$$("ID0Box"), Util.wordBits, true, 0b0111, "ID0Reg_", "ID.0");

        this.MQ1Reg = new DiagRegister(this.$$("MQ1Box"), Util.wordBits, true, 0b1110, "MQ1Reg_", "MQ.1");
        this.MQ0Reg = new DiagRegister(this.$$("MQ0Box"), Util.wordBits, true, 0b0111, "MQ0Reg_", "MQ.0");

        this.PN1Reg = new DiagRegister(this.$$("PN1Box"), Util.wordBits, true, 0b1110, "PN1Reg_", "PN.1");
        this.PN0Reg = new DiagRegister(this.$$("PN0Box"), Util.wordBits, true, 0b0111, "PN0Reg_", "PN.0");

        this.$$("LineNr").addEventListener("focus", this.boundFocusHandler);
        this.$$("LineNr").addEventListener("change", this.boundDumpLine);
        this.$$("BPSetLine").addEventListener("focus", this.boundFocusHandler);
        this.$$("BPSetLine").addEventListener("change", this.boundBPSetChange);
        this.$$("BPSetWord").addEventListener("focus", this.boundFocusHandler);
        this.$$("BPSetWord").addEventListener("change", this.boundBPSetChange);
        this.$$("BPSetCheck").addEventListener("click", this.boundBPSetChange);
        this.$$("StepBtn").addEventListener("click", this.boundProcStep);
        this.$$("BPBtn").addEventListener("click", this.boundProcBP);
        this.$$("GoBtn").addEventListener("click", this.boundProcGo);
        this.$$("StopBtn").addEventListener("click", this.boundProcStop);
        this.window.addEventListener("unload", this.boundShutDown);

        this.updatePanel();
        if (!this.intervalToken) {
            this.intervalToken = this.window.setInterval(this.boundUpdatePanel, DiagPanel.displayRefreshPeriod);
        }
    }

    /**************************************/
    shutDown() {
        /* Closes the panel, unwires its events, and deallocates its resources */

        this.$$("LineNr").removeEventListener("change", this.boundDumpLine);

        this.$$("LineNr").removeEventListener("focus", this.boundFocusHandler);
        this.$$("LineNr").removeEventListener("change", this.boundDumpLine);
        this.$$("BPSetLine").removeEventListener("focus", this.boundFocusHandler);
        this.$$("BPSetLine").removeEventListener("change", this.boundBPSetChange);
        this.$$("BPSetWord").removeEventListener("focus", this.boundFocusHandler);
        this.$$("BPSetWord").removeEventListener("change", this.boundBPSetChange);
        this.$$("BPSetCheck").removeEventListener("click", this.boundBPSetChange);
        this.$$("StepBtn").removeEventListener("click", this.boundProcStep);
        this.$$("BPBtn").removeEventListener("click", this.boundProcBP);
        this.$$("GoBtn").removeEventListener("click", this.boundProcGo);
        this.$$("StopBtn").removeEventListener("click", this.boundProcStop);
        if (this.intervalToken) {       // if the display auto-update is running
            this.window.clearInterval(this.intervalToken);  // kill it
            this.intervalToken = 0;
        }

        if (this.window) {
            this.window.removeEventListener("unload", this.boundShutDown);
            if (!this.window.closed) {
                this.window.close();
            }

            this.window = this.doc = this.panel = null;
            this.context.closeDiagPanel();
        }
    }

} // class DiagPanel
