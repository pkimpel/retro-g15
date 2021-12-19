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

import {PanelRegister} from "./PanelRegister.js";
import {NeonLamp} from "./NeonLamp.js";
import {ColoredLamp} from "./ColoredLamp.js";
import {ToggleSwitch} from "./ToggleSwitch.js";

class ControlPanel {

    /**************************************/
    constructor(context) {
        /* Constructs the G15 control panel controls and wires up their events.
        "context" is an object passing other objects and callback functions from
        the global script:
            $$() returns an object reference from its id value
            systemShutDown() shuts down the emulator
        */
        let $$ = context.$$;
        let panel = $$("ControlPanel");
        const panelCenter = panel.clientWidth / 2;

        this.$$ = $$;
        this.context = context;
        this.panel = panel;

        // Paper tape panel
        $$("PunchTape").textContent = "";
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

        $$("PowerOffBtn").addEventListener("click", context.systemShutDown, false);
        //$$("ResetBtn").addEventListener("click", context.XXX, false);
        this.warmUp();
    }

    /**************************************/
    close() {
        /* Closes the panel, unwires its events, and deallocates its resources */

        this.regCharacteristic = null;
        this.regSource = null;
        this.regDest = null;
        this.regIO = null;
        this.regCmdLine = null;
        this.lampOverflow = null;
        this.lampGODA = null;
        this.lampHalt = null;
        this.lampDBPR = null;
        this.lampPSign = null;
        this.lampNCAR = null;
        this.lampTest = null;
        this.lampAS = null;

        this.dcPowerLamp = null;
        this.readyLamp = null;

        this.$$("PowerOffBtn").removeEventListener("click", this.context.systemShutDown, false);
        //this.$$("ResetBtn").removeEventListener("click", this.context.XXX, false);
    }

    /**************************************/
    warmUp() {
        /* Simulates power warm-up by gradually increasing the brightness of
        the DC Power lamp */
        let level = 0;                  // lamp intensity level

        let brighten = () => {
            if (level < 5) {
                ++level;
                this.dcPowerLamp.element.className = this.dcPowerLamp.levelClass[level];
                setTimeout(brighten, 150);
            } else {
                this.dcPowerLamp.element.className = this.dcPowerLamp.litClass;
            }
        };

        setTimeout(brighten, 2000);
    }

} // class ControlPanel