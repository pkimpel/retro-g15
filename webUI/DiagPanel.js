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

import {DiagRegister} from "./DiagRegister.js";
import {DiagLamp} from "./DiagLamp.js";
import {openPopup} from "./PopupUtil.js";

class DiagPanel {

    /**************************************/
    constructor(context) {
        /* Constructs the G15 diagnostic panel controls and wires up their events.
        "context" is an object passing other objects and callback functions from
        the global script:
            $$() returns an object reference from its id value
            systemShutDown() shuts down the emulator
        */
        const w = 740;
        const h = 400;

        this.context = context;
        this.intervalToken = 0;
        this.boundUpdatePanel = this.updatePanel.bind(this);
        this.boundShutDown = this.shutDown.bind(this);

        // Create the panel window
        this.doc = null;
        this.window = null;
        openPopup(window, "./DiagPanel.html", "DiagPanel",
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
    updatePanel() {
        /* Updates the panel registers and flip-flops from processor state */
        let p = this.context.processor; // local copy of Processor reference
        let drum = p.drum;              // local copy of Drum reference

        this.drumLoc.updateLampGlow(drum.L.glow);
        this.cmdLoc.updateLampGlow(p.cmdLoc.glow);
        this.CDReg.updateLampGlow(p.CD.glow);
        this.RCLamp.set(p.RC.glow);
        this.TRLamp.set(p.TR.glow);
        this.CHLamp.set(p.CH.glow);
        this.CGLamp.set(p.CG.glow);
        this.CSLamp.set(p.CS.glow);
        this.FOLamp.set(p.FO.glow);

        this.DILamp.set(p.DI.glow);
        this.TReg.updateLampGlow(p.T.glow);
        this.BPLamp.set(p.BP.glow);
        this.NReg.updateLampGlow(p.N.glow);
        this.CAReg.updateLampGlow(p.CA.glow);
        this.SReg.updateLampGlow(p.S.glow);
        this.DReg.updateLampGlow(p.D.glow);
        this.C1Lamp.set(p.C1.glow);

        this.ARReg.updateLampGlow(drum.AR.glow);
        this.IPLamp.set(p.IP.glow);

        this.ID1Reg.updateLampGlow(drum.ID[1].glow);
        this.ID0Reg.updateLampGlow(drum.ID[0].glow);

        this.MQ1Reg.updateLampGlow(drum.MQ[1].glow);
        this.MQ0Reg.updateLampGlow(drum.MQ[0].glow);

        this.PN1Reg.updateLampGlow(drum.PN[1].glow);
        this.PN0Reg.updateLampGlow(drum.PN[0].glow);
    }

    /**************************************/
    diagPanelOnLoad(ev) {
        /* Event handler for the window's onload event */
        let e = null;                   // temp element reference
        let p = this.p;                 // local copy of processor object

        this.doc = ev.target;
        this.window = this.doc.defaultView;
        this.panel = this.$$("DiagPanel");

        this.drumLoc = new DiagRegister(this.$$("DrumLocBox"), 7, false, false, "DrumLoc_", "Drum Loc");
        this.cmdLoc = new DiagRegister(this.$$("CmdLocBox"), 7, false, false, "CmdLoc_", "Cmd Loc");
        this.CDReg = new DiagRegister(this.$$("CDBox"), 3, false, false, "CDReg_", "CD");
        this.RCLamp = new DiagLamp(this.$$("RCBox"), 4, 2, "RCLamp");
        this.RCLamp.setCaption("RC");
        this.TRLamp = new DiagLamp(this.$$("TRBox"), 4, 2, "TRLamp");
        this.TRLamp.setCaption("TR");
        this.CHLamp = new DiagLamp(this.$$("CHBox"), 4, 2, "CHLamp");
        this.CHLamp.setCaption("CH");
        this.CGLamp = new DiagLamp(this.$$("CGBox"), 4, 2, "CGLamp");
        this.CGLamp.setCaption("CG");
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
        this.CAReg = new DiagRegister(this.$$("CABox"), 2, false, false, "CAReg_", "CHAR");
        this.SReg = new DiagRegister(this.$$("SBox"), 5, false, false, "SReg_", "S");
        this.DReg = new DiagRegister(this.$$("DBox"), 5, false, false, "DReg_", "D");
        this.C1Lamp = new DiagLamp(this.$$("C1Box"), 4, 2, "SDLamp");
        this.C1Lamp.setCaption("S/D");

        this.ARReg = new DiagRegister(this.$$("ARBox"), 29, true, true, "ARReg_", "AR");
        this.IPLamp = new DiagLamp(this.$$("IPBox"), 4, 2, "IPLamp");
        this.IPLamp.setCaption("IP");

        this.ID1Reg = new DiagRegister(this.$$("ID1Box"), 29, true, false, "ID1Reg_", "ID odd");
        this.ID0Reg = new DiagRegister(this.$$("ID0Box"), 29, true, true, "ID0Reg_", "ID even");

        this.MQ1Reg = new DiagRegister(this.$$("MQ1Box"), 29, true, false, "MQ1Reg_", "MQ odd");
        this.MQ0Reg = new DiagRegister(this.$$("MQ0Box"), 29, true, true, "MQ0Reg_", "MQ even");

        this.PN1Reg = new DiagRegister(this.$$("PN1Box"), 29, true, false, "PN1Reg_", "PN odd");
        this.PN0Reg = new DiagRegister(this.$$("PN0Box"), 29, true, true, "PN0Reg_", "PN even");

        this.window.addEventListener("unload", this.boundShutDown);
        if (!this.intervalToken) {
            this.intervalToken = this.window.setInterval(this.boundUpdatePanel, DiagPanel.displayRefreshPeriod);
        }
    }

    /**************************************/
    shutDown() {
        /* Closes the panel, unwires its events, and deallocates its resources */

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