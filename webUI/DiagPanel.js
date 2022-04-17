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

class DiagPanel {

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
        this.boundUpdatePanel = this.updatePanel.bind(this);
        this.boundShutDown = this.shutDown.bind(this);
        this.boundDumpLine = this.dumpLine.bind(this);
        this.boundProcStep = context.processor.step.bind(context.processor);
        this.boundProcGo = context.processor.start.bind(context.processor);
        this.boundProcStop = context.processor.stop.bind(context.processor);

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
    dumpLine() {
        /* Dumps the currently-specified line to the LineDump <pre> in signed hex */
        let text = this.$$("LineNr").value.trim().toUpperCase();
        let lineNr = (text == "MZ" ? 32 : parseInt(text) || 0);

        switch (true) {
        case lineNr >= 0 && lineNr < 24:
        case lineNr == 32:
            let drum = this.context.processor.drum;
            let top = (lineNr < 20 ? Util.longLineSize : Util.fastLineSize);
            let inc = (lineNr < 20 ? 12 : Util.fastLineSize);
            let text = "";

            for (let x=0; x<top; x+=inc) {
                text += x.toString().padStart(3, " ");
                for (let y=0; y<inc; ++y) {
                    let word = drum.line[lineNr][x+y];
                    text += " " + ((word & 1) ? "-" : " ") +
                                  Util.g15Hex(word >> 1).padStart(7, "0");
                }

                text += "\n";
            }

            this.$$("LineDump").textContent = text;
        }
    }

    /**************************************/
    dumpFastLine(lineNr) {
        /* Dumps the currently-specified fast (4-word) line to the to its text
        area in signed hex */
        let drum = this.context.processor.drum;
        let text = "";

        for (let x=0; x<Util.fastLineSize; ++x) {
            let word = drum.line[lineNr][x];
            text += " " + ((word & 1) ? "-" : " ") +
                          Util.g15Hex(word >> 1).padStart(7, "0");
        }

        this.$$(`Line${lineNr}Dump`).textContent = text;
    }

    /**************************************/
    updatePanel() {
        /* Updates the panel registers and flip-flops from processor state */
        let p = this.context.processor; // local copy of Processor reference
        let drum = p.drum;              // local copy of Drum reference
        let now = performance.now();

        this.drumLoc.updateFromRegister(drum.L);
        this.cmdLoc.updateFromRegister(p.cmdLoc);
        this.CDReg.updateFromRegister(p.CD);
        this.RCLamp.updateFromFlipFlop(p.RC);
        this.TRLamp.updateFromFlipFlop(p.TR);
        this.CHLamp.updateFromFlipFlop(p.CH);
        this.CGLamp.updateFromFlipFlop(p.CG);
        this.CQLamp.updateFromFlipFlop(p.CQ);
        this.CSLamp.updateFromFlipFlop(p.CS);
        this.FOLamp.updateFromFlipFlop(p.FO);

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
            this.dumpFastLine(20);
            this.dumpFastLine(21);
            this.dumpFastLine(22);
            this.dumpFastLine(23);
            this.dumpLine();
        }
    }

    /**************************************/
    diagPanelOnLoad(ev) {
        /* Event handler for the window's onload event */
        let e = null;                   // temp element reference

        this.doc = ev.target;
        this.window = this.doc.defaultView;
        this.panel = this.$$("DiagPanel");

        this.drumLoc = new DiagRegister(this.$$("DrumLocBox"), 7, false, false, "DrumL_", "Drum L");
        this.cmdLoc = new DiagRegister(this.$$("CmdLocBox"), 7, false, false, "CmdL_", "Cmd L");
        this.CDReg = new DiagRegister(this.$$("CDBox"), 3, false, false, "CDReg_", "CD");
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

        this.DILamp = new DiagLamp(this.$$("DIBox"), 4, 2, "IDLamp");
        this.DILamp.setCaption("I/D");
        this.TReg = new DiagRegister(this.$$("TBox"), 7, false, false, "TReg_", "T");
        this.BPLamp = new DiagLamp(this.$$("BPBox"), 4, 2, "BPLamp");
        this.BPLamp.setCaption("BP");
        this.NReg = new DiagRegister(this.$$("NBox"), 7, false, false, "NReg_", "N");
        this.CReg = new DiagRegister(this.$$("CBox"), 2, false, false, "CReg_", "C");
        this.SReg = new DiagRegister(this.$$("SBox"), 5, false, false, "SReg_", "S");
        this.DReg = new DiagRegister(this.$$("DBox"), 5, false, false, "DReg_", "D");
        this.C1Lamp = new DiagLamp(this.$$("C1Box"), 4, 2, "SDLamp");
        this.C1Lamp.setCaption("S/D");

        this.ARReg = new DiagRegister(this.$$("ARBox"), 29, true, true, "ARReg_", "AR");
        this.IPLamp = new DiagLamp(this.$$("IPBox"), 4, 2, "IPLamp");
        this.IPLamp.setCaption("IP");

        this.ID1Reg = new DiagRegister(this.$$("ID1Box"), 29, true, false, "ID1Reg_", "ID:1");
        this.ID0Reg = new DiagRegister(this.$$("ID0Box"), 29, true, true,  "ID0Reg_", "ID:0");

        this.MQ1Reg = new DiagRegister(this.$$("MQ1Box"), 29, true, false, "MQ1Reg_", "MQ:1");
        this.MQ0Reg = new DiagRegister(this.$$("MQ0Box"), 29, true, true,  "MQ0Reg_", "MQ:0");

        this.PN1Reg = new DiagRegister(this.$$("PN1Box"), 29, true, false, "PN1Reg_", "PN:1");
        this.PN0Reg = new DiagRegister(this.$$("PN0Box"), 29, true, true,  "PN0Reg_", "PN:0");

        this.$$("LineNr").addEventListener("change", this.boundDumpLine);
        this.$$("StepBtn").addEventListener("click", this.boundProcStep);
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
        this.$$("StepBtn").removeEventListener("click", this.boundProcStep);
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


// Static class properties

DiagPanel.displayRefreshPeriod = 50;    // ms
