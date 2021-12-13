/***********************************************************************
* retro-g15/emulator BitField.js
************************************************************************
* Copyright (c) 2021, Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* JavaScript class module for bit field extraction and insertion.
************************************************************************
* 2021-12-08  P.Kimpel
*   Original version, from retro-220 B220Processor.js.
***********************************************************************/

export {BitField}

class BitField {

    // No constructor

    /**************************************/
    static bitTest(word, bit) {
        /* Extracts and returns the specified bit from the word */
        let p;                              // bottom portion of word power of 2

        if (bit > 0) {
            return ((word - word % (p = BitField.pow2[bit]))/p) % 2;
        } else {
            return word % 2;
        }
    }

    /**************************************/
    static bitSet(word, bit) {
        /* Sets the specified bit in word and returns the updated word */
        let ue = bit+1;                     // word upper power exponent
        let bpower =                        // bottom portion of word power of 2
            BitField.pow2[bit];
        let bottom =                        // unaffected bottom portion of word
            (bit <= 0 ? 0 : (word % bpower));
        let top =                           // unaffected top portion of word
            word - (word % BitField.pow2[ue]);

        return bpower + top + bottom;
    }

    /**************************************/
    static bitReset(word, bit) {
        /* Resets the specified bit in word and returns the updated word */
        let ue = bit+1;                     // word upper power exponent
        let bottom =                        // unaffected bottom portion of word
            (bit <= 0 ? 0 : (word % BitField.pow2[bit]));
        let top =                           // unaffected top portion of word
            word - (word % BitField.pow2[ue]);

        return top + bottom;
    }

    /**************************************/
    static bitFlip(word, bit) {
        /* Complements the specified bit in word and returns the updated word */
        let ue = bit+1;                     // word upper power exponent
        let bpower =                        // bottom portion of word power of 2
            BitField.pow2[bit];
        let bottom =                        // unaffected bottom portion of word
            (bit <= 0 ? 0 : (word % bpower));
        let middle =                        // bottom portion of word starting with affected bit
            word % BitField.pow2[ue];
        let top = word - middle;            // unaffected top portion of word

        if (middle >= bpower) {             // if the affected bit is a one
            return top + bottom;                // return the result with it set to zero
        } else {                            // otherwise
            return bpower + top + bottom;       // return the result with it set to one
        }
    }

    /**************************************/
    static fieldIsolate(word, start, width) {
        /* Extracts a bit field [start:width] from word and returns the field */
        let le = start-width+1;             // lower power exponent
        let p;                              // bottom portion of word power of 2

        return (le <= 0 ? word :
                          (word - word % (p = BitField.pow2[le]))/p
                ) % BitField.pow2[width];
    }

    /**************************************/
    static fieldInsert(word, start, width, value) {
        /* Inserts a bit field from the low-order bits of value ([48-width:width])
        into word.[start:width] and returns the updated word */
        let ue = start+1;                   // word upper power exponent
        let le = ue-width;                  // word lower power exponent
        let bpower =                        // bottom portion of word power of 2
            BitField.pow2[le];
        let bottom =                        // unaffected bottom portion of word
            (le <= 0 ? 0 : (word % bpower));
        let top =                           // unaffected top portion of word
            (ue <= 0 ? 0 : (word - (word % BitField.pow2[ue])));

        return (value % BitField.pow2[width])*bpower + top + bottom;
    }

    /**************************************/
    static fieldTransfer(word, wstart, width, value, vstart) {
        /* Inserts a bit field from value.[vstart:width] into word.[wstart:width] and
        returns the updated word */
        let ue = wstart+1;                  // word upper power exponent
        let le = ue-width;                  // word lower power exponent
        let ve = vstart-width+1;            // value lower power exponent
        let vpower;                         // bottom port of value power of 2
        let bpower =                        // bottom portion of word power of 2
            BitField.pow2[le];
        let bottom =                        // unaffected bottom portion of word
            (le <= 0 ? 0 : (word % bpower));
        let top =                           // unaffected top portion of word
            (ue <= 0 ? 0 : (word - (word % BitField.pow2[ue])));

        return ((ve <= 0 ? value :
                           (value - value % (vpower = BitField.pow2[ve]))/vpower
                    ) % BitField.pow2[width]
                )*bpower + top + bottom;
    }

} // class BitField


// Static class properties

BitField.pow2 = [ // powers of 2 from 0 to 52
                     0x1,              0x2,              0x4,              0x8,
                    0x10,             0x20,             0x40,             0x80,
                   0x100,            0x200,            0x400,            0x800,
                  0x1000,           0x2000,           0x4000,           0x8000,
                 0x10000,          0x20000,          0x40000,          0x80000,
                0x100000,         0x200000,         0x400000,         0x800000,
               0x1000000,        0x2000000,        0x4000000,        0x8000000,
              0x10000000,       0x20000000,       0x40000000,       0x80000000,
             0x100000000,      0x200000000,      0x400000000,      0x800000000,
            0x1000000000,     0x2000000000,     0x4000000000,     0x8000000000,
           0x10000000000,    0x20000000000,    0x40000000000,    0x80000000000,
          0x100000000000,   0x200000000000,   0x400000000000,   0x800000000000,
         0x1000000000000,  0x2000000000000,  0x4000000000000,  0x8000000000000,
        0x10000000000000];

BitField.mask2 = [ // (2**n)-1 for n from 0 to 52
                     0x0,              0x1,              0x3,              0x7,
                    0x0F,             0x1F,             0x3F,             0x7F,
                   0x0FF,            0x1FF,            0x3FF,            0x7FF,
                  0x0FFF,           0x1FFF,           0x3FFF,           0x7FFF,
                 0x0FFFF,          0x1FFFF,          0x3FFFF,          0x7FFFF,
                0x0FFFFF,         0x1FFFFF,         0x3FFFFF,         0x7FFFFF,
               0x0FFFFFF,        0x1FFFFFF,        0x3FFFFFF,        0x7FFFFFF,
              0x0FFFFFFF,       0x1FFFFFFF,       0x3FFFFFFF,       0x7FFFFFFF,
             0x0FFFFFFFF,      0x1FFFFFFFF,      0x3FFFFFFFF,      0x7FFFFFFFF,
            0x0FFFFFFFFF,     0x1FFFFFFFFF,     0x3FFFFFFFFF,     0x7FFFFFFFFF,
           0x0FFFFFFFFFF,    0x1FFFFFFFFFF,    0x3FFFFFFFFFF,    0x7FFFFFFFFFF,
          0x0FFFFFFFFFFF,   0x1FFFFFFFFFFF,   0x3FFFFFFFFFFF  , 0x7FFFFFFFFFFF,
         0x0FFFFFFFFFFFF,  0x1FFFFFFFFFFFF,  0x3FFFFFFFFFFFF,  0x7FFFFFFFFFFFF,
        0x0FFFFFFFFFFFFF];
