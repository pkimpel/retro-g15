export { Sound }

import * as Util from "../emulator/Util.js";
import {BitField} from "../emulator/BitField.js";

class Sound {

    constructor(context) {
        this.drum = context.processor.drum;
        this.enabled = false;
        this.audioCtx = new AudioContext();

        //Create a buffer for the sound...
        const myArrayBuffer = this.audioCtx.createBuffer(
            1,  //channels
            Util.longLineSize * 32, //One sample per BIT
            Util.longLineSize * 32 * (Util.drumRPM / 60) //Samples per second
        );

        //Create audio source using the buffer
        const source = this.audioCtx.createBufferSource();
        source.buffer = myArrayBuffer;
        source.loop = true; //Drum spins round and round

        //Connect to the audio context
        source.connect(this.audioCtx.destination);
        source.start();

        //This is gross, but it was quick. Copy the drum contents
        //to the buffer every 100ms. Can probably tap into the drum
        //to find out when it's been written to, but this is a cheap
        //proof of concept
        setInterval(()=>{
            //The buffer and the position in the buffer
            const buf = myArrayBuffer.getChannelData(0);
            let i = 0; 

            //For every word in lin 19
            for ( let word of this.drum.line[19] ){
                //For every bit in that word
                for ( let bitNr = 0; bitNr < 32; bitNr++ ){
                    //Put a value in the buffer
                    if ( BitField.bitTest(word, bitNr) ){
                        buf[i] = .01;
                    } else {
                        buf[i] = -.01;
                    }
                    i++; //increment the position
                }
            }
        }, 100)
    }

}