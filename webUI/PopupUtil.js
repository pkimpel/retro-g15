/***********************************************************************
* retro-G15/webUI PopupUtil.js
************************************************************************
* Copyright (c) 2021, Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* Bendix G-15 emulator popup window opening module.
* Queues window open requests and processes them to completion sequentially.
* This attempts to defeat browsers that limit how quickly a page can open
* sub-windows if there has been no user action to trigger the open.
*
* Attempts to open a window for an entry in the queue. If the open fails,
* requeues the request entry back to the head of the queue, increases the
* delay time between attempts, and schedules a retry for the request using
* that delay. If the attempt succeeds, attaches a load event to the new
* window, then if the queue is non-empty schedules the next entry using the
* current delay time.
************************************************************************
* 2021-12-01  P.Kimpel
*   Original version, from retro-205 js
***********************************************************************/

export {openPopup};

// Private variables
let popupOpenDelayIncrement = 250;      // increment for pop-up open delay adjustment, ms
let popupOpenDelay = 500;               // current pop-up open delay, ms
let popupOpenQueue = [];                // queue of pop-up open argument objects


/**************************************/
function openPopup(parent, url, windowName, options, context, onload) {
    /* Schedules the opening of a pop-up window so that browsers such as Apple
    Safari (11.0+) will not block the opens if they occur too close together.
    Parameters:
        parent:     parent window for the pop-up
        url:        url of window context, passed to window.open()
        windowName: internal name of the window, passed to window.open()
        options:    string of window options, passed to window.open()
        context:    object context ("this") for the onload function (may be null)
        onload:     event handler for the window's onload event (may be null).
    If the queue of pending pop-up opens in popupOpenQueue[] is empty,
    then attempts to open the window immediately. Otherwise queues the open
    parameters, which will be dequeued and acted upon after the previously-
    queued entries are completed by dequeuePopup() */

    popupOpenQueue.push({
        parent: parent,
        url: url,
        windowName: windowName,
        options: options,
        context: context,
        onload: onload});
    if (popupOpenQueue.length == 1) { // queue was empty
        dequeuePopup();
    }
}

/**************************************/
function dequeuePopup() {
    /* Dequeues a popupOpenQueue[] entry and attempts to open the pop-up window.
    Called either directly by openPopup() when an entry is inserted
    into an empty queue, or by setTimeout() after a delay. If the open fails,
    the entry is reinserted into the head of the queue, the open delay is
    incremented, and this function is rescheduled for the new delay. If the
    open is successful, and the queue is non-empty, then this function is
    scheduled for the current open delay to process the next entry in the queue */
    let entry = popupOpenQueue.shift();
    let loader1 = null;
    let loader2 = null;
    let win = null;

    if (entry) {
        try {
            win = entry.parent.open(entry.url, entry.windowName, entry.options);
        } catch (e) {
            win = null;
        }

        if (!win) {                     // window open failed, requeue
            popupOpenQueue.unshift(entry);
            popupOpenDelay += popupOpenDelayIncrement;
            setTimeout(dequeuePopup, popupOpenDelay);
            //console.log("Pop-up open failed: " + entry.windowName + ", new delay=" + popupOpenDelay + "ms");
        } else {                        // window open was successful
            if (entry.onload) {
                loader1 = entry.onload.bind(entry.context);
                win.addEventListener("load", loader1, false);
            }

            loader2 = function(ev) {    // remove the load event listeners after loading
                win.removeEventListener("load", loader2, false);
                if (loader1) {
                    win.removeEventListener("load", loader1, false);
                }
            };

            win.addEventListener("load", loader2, false);
            if (popupOpenQueue.length > 0) {
                setTimeout(dequeuePopup, popupOpenDelay);
            }
        }
    }
}
