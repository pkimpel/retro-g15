/***********************************************************************
* retro-g15/webUI ControlPanel.js
************************************************************************
* Copyright (c) 2021, Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* Bendix G-15 emulator support class implementing display and behavior
* for the main control panel.
************************************************************************
* 2021-12-04  P.Kimpel
*   Original version, extracted from G15.js.
***********************************************************************/

export {ControlPanel};

import * as IOCodes from "../emulator/IOCodes.js";
import * as Util from "../emulator/Util.js";
import {ColoredLamp} from "./ColoredLamp.js";
import {NeonLamp} from "./NeonLamp.js";
import {PanelRegister} from "./PanelRegister.js";
import {ToggleSwitch} from "./ToggleSwitch.js";

class ControlPanel {

    /**************************************/
    constructor(context) {
        /* Constructs the G15 control panel controls and wires up their events.
        "context" is an object passing other objects and callback functions from
        the global script:
            $$() returns an object reference from its id value
            processor is the Processor object
            systemShutDown() shuts down the emulator
        */
        let $$ = this.$$ = context.$$;
        let panel = this.panel = $$("ControlPanel");
        const panelCenter = panel.clientWidth / 2;

        this.context = context;
        this.intervalToken = 0;         // interval timer cancel token
        this.boundControlSwitchChange = this.controlSwitchChange.bind(this);
        this.boundUpdatePanel = this.updatePanel.bind(this);
        this.boundSystemReset = this.systemReset.bind(this);

        this.systemBell = $$("SystemBell");
        this.lastBellTime = 0;

        // Paper tape panel
        $$("PunchTapeView").textContent = "";
        $$("PRFileSelector").value = null;
        $$("PRTapeSupplyBar").value = 0;

        // Characteristic register
        this.regCharacteristic = new PanelRegister($$("CharacteristicReg"), 2, 1, "CharacteristicReg_", "CHARACTERISTIC");
        this.regCharacteristic.lamps[0].element.style.left =
                (this.regCharacteristic.lamps[0].element.offsetLeft + 20).toString() + "px";

        // Source register
        this.regSource = new PanelRegister($$("SourceReg"), 5, 1, "SourceReg_", "SOURCE");
        this.regSource.lamps[0].setCaption("1", true);
        this.regSource.lamps[1].setCaption("2", true);
        this.regSource.lamps[2].setCaption("4", true);
        this.regSource.lamps[3].setCaption("8", true);
        this.regSource.lamps[4].setCaption("16", true);

        // Overflow lamp
        this.lampOverflow = new NeonLamp(panel, panelCenter+132, 36, "OverflowLamp");
        this.lampOverflow.setCaption("O'FLO", false);

        // GO-DA lamp
        this.lampGODA = new NeonLamp(panel, panelCenter+132+PanelRegister.hSpacing, 36, "GODALamp");
        this.lampGODA.setCaption("GO", false);
        this.lampGODA.setCaption("D.A.", true);

        // HALT lamp
        this.lampHalt = new NeonLamp(panel, panelCenter+132+PanelRegister.hSpacing*2, 36, "HaltLamp");
        this.lampHalt.setCaption("HALT", false);

        // Command Line register
        this.regCmdLine = new PanelRegister($$("CmdLineReg"), 3, 1, "CmdLineReg_", "COMMAND LINE");

        // Destination register
        this.regDest = new PanelRegister($$("DestReg"), 5, 1, "DestReg_", "DESTINATION");
        this.regDest.lamps[0].setCaption("1", true);
        this.regDest.lamps[1].setCaption("2", true);
        this.regDest.lamps[2].setCaption("4", true);
        this.regDest.lamps[3].setCaption("8", true);
        this.regDest.lamps[4].setCaption("16", true);

        // Double-Precision lamp
        this.lampDBPR = new NeonLamp(panel, panelCenter+142, 104, "DBPRLamp");
        this.lampDBPR.setCaption("DB-PR", false);

        // PN-register sign lamp
        this.lampPSign = new NeonLamp(panel, panelCenter+122+PanelRegister.hSpacing*2, 104, "PSignLamp");
        this.lampPSign.setCaption("P - SIGN", false);

        // NC-AR lamp
        this.lampNCAR = new NeonLamp(panel, panelCenter-248+PanelRegister.hOffset+PanelRegister.hSpacing, 172, "NCARLamp");
        this.lampNCAR.setCaption("NC-AR", false);

        // Input/Output register
        this.regIO = new PanelRegister($$("IOReg"), 5, 1, "IOReg_", "INPUT-OUTPUT");
        this.regIO.lamps[0].setCaption("1", true);
        this.regIO.lamps[1].setCaption("2", true);
        this.regIO.lamps[2].setCaption("4", true);
        this.regIO.lamps[3].setCaption("8", true);
        this.regIO.lamps[4].setCaption("R", true);

        // TEST lamp
        this.lampTest = new NeonLamp(panel, panelCenter+142, 172, "TestLamp");
        this.lampTest.setCaption("TEST", false);

        // Input/Output Auto/Standard reload lamp
        this.lampAS = new NeonLamp(panel, panelCenter+122+PanelRegister.hSpacing*2, 172, "ASLamp");
        this.lampAS.setCaption("AS", false);

        // Typewriter switch panel

        $$("EnableSwitchOff").checked = true;
        $$("PunchSwitchOff").checked = true;
        $$("ComputeSwitchOff").checked = true;

        // Power control panel

        let powerPanel = $$("PowerPanel");

        this.dcPowerLamp = new ColoredLamp(powerPanel, null, null, "DCPowerLamp", "redLamp", "redLit");
        this.readyLamp = new ColoredLamp(powerPanel, null, null, "ReadyLamp", "greenLamp", "greenLit");

        this.violationLamp = new ColoredLamp(powerPanel, null, null, "ViolationLamp", "orangeLamp", "orangeLit");
        this.violationSwitch = new ToggleSwitch(powerPanel, null, null, "ViolationSwitch", "./resources/ToggleDown.png", "./resources/ToggleUp.png");

        // Events

        $$("PowerOffBtn").addEventListener("click", context.systemShutDown, false);
        $$("ResetBtn").addEventListener("click", this.boundSystemReset, false);
        this.violationSwitch.addEventListener("click", this.boundControlSwitchChange, false);

        if (!this.intervalToken) {
            this.intervalToken = setInterval(this.boundUpdatePanel, ControlPanel.displayRefreshPeriod);
        }
    }

    /**************************************/
    enablePanel() {
        /* Enables events for the Control Panel controls that should not be
        until the system has been reset and initialized */

        this.$$("EnableSwitchSet").addEventListener("click", this.boundControlSwitchChange, false);
        this.$$("PunchSwitchSet").addEventListener("click", this.boundControlSwitchChange, false);
        this.$$("ComputeSwitchSet").addEventListener("click", this.boundControlSwitchChange, false);
        this.$$("ViolationResetBtn").addEventListener("click", this.boundControlSwitchChange, false);
    }

    /**************************************/
    updatePanel() {
        /* Updates the panel registers and flip-flops from processor state */
        let p = this.context.processor; // local copy of Processor reference

        p.updateLampGlow(0);
        this.regCmdLine.updateLampGlow(p.CD.glow);
        this.regCharacteristic.updateLampGlow(p.CA.glow);
        this.regDest.updateLampGlow(p.D.glow);
        this.regSource.updateLampGlow(p.S.glow);
        this.regIO.updateLampGlow(p.OC.glow);

        this.lampOverflow.set(p.FO.glow);
        //this.lampGODA.set(??.glow);   // GO-DA lamp not currently implemented
        this.lampHalt.set(p.CH.glow);
        this.lampDBPR.set(p.C1.glow);
        this.lampPSign.set(p.IP.glow);
        this.lampNCAR.set(p.CG.glow);
        this.lampTest.set(p.CQ.glow);
        this.lampAS.set(p.AS.glow);
        this.violationLamp.set(p.VV.glow);
    }

    /**************************************/
    controlSwitchChange(ev) {
        /* Event handler for the pane's switch controls */
        let p = this.context.processor; // local copy of Processor reference

        switch (ev.target.id) {
        case "EnableSwitchOff":
            p.enableSwitchChange(0);
            break;
        case "EnableSwitchOn":
            p.enableSwitchChange(1);
            break;
        case "PunchSwitchOff":
            p.punchSwitchChange(0);
            break;
        case "PunchSwitchOn":
            p.punchSwitchChange(1);
            break;
        case "PunchSwitchRewind":
            p.punchSwitchChange(2);
            break;
        case "ComputeSwitchOff":
            p.computeSwitchChange(0);
            break;
        case "ComputeSwitchGo":
            p.computeSwitchChange(1);
            break;
        case "ComputeSwitchBP":
            p.computeSwitchChange(2);
            break;
        case "ViolationResetBtn":
            p.violationReset();
            break;
        case "ViolationSwitch":
            this.violationSwitch.flip()
            p.violationSwitchChange(this.violationSwitch.state);
            break;
        }
    }

    /**************************************/
    ringBell(wordTimes) {
        /* Rings the system's bell with a volume determined by the number of
        word times specified by the parameter. Due to the reaction time of the
        bell solenoid, it requires three drum cycles (about 87ms) before the
        bell can be activated again */
        let now = performance.now();

        if (this.lastBellTime + ControlPanel.bellRecycleTime < now) {
            let volume = 0.25;              // default maximum volume
            if (wordTimes < Util.longLineSize) {
                volume *= wordTimes/Util.longLineSize;
            }

            this.systemBell.volume = volume;
            this.systemBell.currentTime = 0;
            this.systemBell.play();
            this.lastBellTime = now;
        }
    }

    /**************************************/
    async systemReset(ev) {
        /* Event handler for the RESET button */

        this.dcPowerLamp.set(1);
        await this.context.processor.systemReset();
        this.readyLamp.set(1);
        this.enablePanel();
        this.$$("ResetBtn").disabled = true;
    }

    /**************************************/
    shutDown() {
        /* Closes the panel, unwires its events, and deallocates its resources */

        this.$$("EnableSwitchSet").removeEventListener("click", this.boundControlSwitchChange, false);
        this.$$("PunchSwitchSet").removeEventListener("click", this.boundControlSwitchChange, false);
        this.$$("ComputeSwitchSet").removeEventListener("click", this.boundControlSwitchChange, false);
        this.$$("PowerOffBtn").removeEventListener("click", this.context.systemShutDown, false);
        this.$$("ResetBtn").removeEventListener("click", this.context.boundSystemReset, false);
        this.$$("ViolationResetBtn").removeEventListener("click", this.boundControlSwitchChange, false);
        this.violationSwitch.removeEventListener("click", this.boundControlSwitchChange, false);

        if (this.intervalToken) {
            clearInterval(this.intervalToken);
        }
    }

} // class ControlPanel


// Static class properties

ControlPanel.displayRefreshPeriod = 50; // ms
ControlPanel.bellRecycleTime = Util.drumCycleTime*3;