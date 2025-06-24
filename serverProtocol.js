/**
  Converts a UIntArray to a String
  @param {UIntArray Reader} reader - The DataView we use to read the array
*/
exports.convertIntArrayToString = function(reader, initialOffset) {
    let returnedString = "";
    let finalOffset = 0;
    for (; finalOffset < 99999; finalOffset++) {
      let characterCode = reader.getInt8(initialOffset + (finalOffset));
      if (characterCode === 0) break;
      returnedString += String.fromCharCode(characterCode);
    }
    return [decodeURIComponent(returnedString), initialOffset + finalOffset + 1];
  }
  
  /**
  breaks down a packet into readable information and returns the packet info in an array
  @param {DataView} reader - the packet we recieved
  @param {Array} dataTypes - goes through the buffer and takes the datatype next on this array
  @return {Array} the decoded array with all the sent information
  */
  exports.decodePacket = function (reader, dataTypes, initialOffset = 0) {
    let offset = initialOffset;
    let decoded = [];
    let repeating = [];
    let zeroRepeats = false;
    for (let i = 0; i < dataTypes.length; i++) {
      let usedDecode = decoded;
      for (let j = 0; j < repeating.length; j++) {
        usedDecode = usedDecode[usedDecode.length - 1];
      }
      if (zeroRepeats && dataTypes[i] !== "end") continue;
      switch (dataTypes[i]) {
        case "int8": {
          usedDecode.push(reader.getInt8(offset));
          offset += 1;
          break;
        }
        case "int16": {
          usedDecode.push(reader.getInt16(offset));
          offset += 2;
          break;
        }
        case "int32": {
          usedDecode.push(reader.getInt32(offset));
          offset += 4;
          break;
        }
        case "float32": {
          usedDecode.push(reader.getFloat32(offset));
          offset += 4;
          break;
        }
        case "int64": {
          usedDecode.push(reader.getInt64(offset));
          offset += 8;
          break;
        }
  
        case "float32array": {
          let arraylength = reader.getInt32(offset);
          offset += 4;
          let decodedarray = [];
          for (let j = 0; j < arraylength; j++) {
            decodedarray.push(reader.getFloat32(offset));
            offset += 4;
          }
          usedDecode.push(decodedarray);
          break;
        }
  
        case "float32arrayarray": {
          let outerarraylength = reader.getInt32(offset);
          offset += 4;
          let decodedouterarray = [];
          for (let j = 0; j < outerarraylength; j++) {
            let innerarraylength = reader.getInt32(offset);
            let decodedinnerarray = [];
            offset += 4;
            for (let k = 0; k < innerarraylength; k++) {
              decodedinnerarray.push(reader.getFloat32(offset));
              offset += 4;
            }
            decodedouterarray.push(decodedinnerarray);
          }
          usedDecode.push(decodedouterarray);
          break;
        }
  
        case "string": {
          let decodedString = exports.convertIntArrayToString(reader, offset);
          usedDecode.push(decodedString[0]);
          offset = decodedString[1];
          break;
        }
  
        case "repeat": {
          usedDecode.push([]);
          repeating.push([reader.getInt32(offset), i]);
          if (reader.getInt32(offset) === 0) zeroRepeats = true;
          offset += 8;
          break;
        }
  
        case "end": {
          zeroRepeats = false;
          for (let a = 0; a < 99; a++) {
            repeating[repeating.length - 1][0]--;
            if (repeating[repeating.length - 1][0] <= 0) {
              repeating.splice(repeating.length - 1, 1);
              break;
            }
            else {
              i = repeating[repeating.length - 1][1];
            }
            break;
          }
          break;
        }
      }
    }
    
    return decoded;
  }
  
  /**
  Calculates the length of a set of dataTypes
  */
  exports.getPacketOffset = function (reader, dataTypes) {
    let offset = 0;
    let repeating = [];
    for (let i = 0; i < dataTypes.length; i++) {
      switch (dataTypes[i]) {
        case "int8": {
          offset += 1;
          break;
        }
        case "int16": {
          offset += 2;
          break;
        }
        case "int32": {
          offset += 4;
          break;
        }
        case "float32": {
          offset += 4;
          break;
        }
        case "int64": {
          offset += 8;
          break;
        }
  
        case "float32array": {
          let arraylength = reader.getInt32(offset);
          offset += 4 * (arraylength + 1);
          break;
        }
  
        case "float32arrayarray": {
          let outerarraylength = reader.getInt32(offset);
          offset += 4;
          for (let j = 0; j < outerarraylength; j++) {
            let innerarraylength = reader.getInt32(offset);
            offset += 4;
            for (let k = 0; k < innerarraylength; k++) {
              offset += 4;
            }
          }
          break;
        }
  
        case "string": {
          let decodedString = exports.convertIntArrayToString(reader, offset);
          offset = decodedString[1];
          break;
        }
  
        case "repeat": {
          repeating.push([reader.getInt32(offset), i]);
          offset += 8;
          break;
        }
  
        case "end": {
          //offset += 1;
          for (let a = 0; a < 99; a++) {
            repeating[repeating.length - 1][0]--;
            if (repeating[repeating.length - 1][0] <= 0) {
              repeating.splice(repeating.length - 1, 1);
              break;
            }
            else {
              i = repeating[repeating.length - 1][1];
            }
            break;
          }
          break;
        }
      }
    }
    
    return offset;
  }
  
  /**
  encodes an array of data into an arraybuffer to send, and calculate how long it must be to do so
  @param {Array} data - all the data we are encoding
  @param {Array} dataTypes - the datatype we convert each bit of data into
  @return {ArrayBuffer} the encoded arraybuffer, ready to be sent
  */
  exports.encodePacket = function (data, dataTypes) {
    let offset = 0;
    let repeating = [];
    let zeroRepeats = false
    let dataPosition = 0;
    
    let arraylength = 0;
    for (let i = 0; i < dataTypes.length; i++) {
      if (zeroRepeats && dataTypes[i] !== "end") continue;
      switch (dataTypes[i]) {
          // integers and floats
        case "int64": arraylength += 4;
        case "float32":
        case "int32": arraylength += 2;
        case "int16": arraylength += 1;
        case "int8": {
          arraylength += 1;
          break;
        }
          // float32array
        case "float32array": {
          arraylength += 4 * (data[dataPosition].length + 1);
          break;
        }
          
          // for vertex and stuff
        case "float32arrayarray": {
          arraylength += 4;
          for (let d of data[dataPosition])
            arraylength += 4 * (d.length + 1);
          break;
        }
          
          // strings
        case "string": {
          arraylength += encodeURIComponent(data[dataPosition]).length + 1;
          break;
        }
          
          // breaks down all data types between this and end a certain number of times
        case "repeat": {
          arraylength += 8;
          repeating.push([data[dataPosition], i]);
          if (data[dataPosition] === 0) zeroRepeats = true;
          break;
        }
  
        case "end": {
          zeroRepeats = false;
          //arraylength += 1;
          for (let a = 0; a < 99; a++) {
            repeating[repeating.length - 1][0]--;
            if (repeating[repeating.length - 1][0] <= 0) {
              repeating.splice(repeating.length - 1, 1);
              break;
            }
            else {
              i = repeating[repeating.length - 1][1];
              dataPosition--;
            }
            break;
          }
          break;
        }
      }
      dataPosition++;
    }
    
    let encoded = new ArrayBuffer(arraylength);
    let dv = new DataView(encoded);
    repeating = [];
    zeroRepeats = false;
    dataPosition = 0;
    
    for (let i = 0; i < dataTypes.length; i++) {
      if (zeroRepeats && dataTypes[i] !== "end") continue;
      switch (dataTypes[i]) {
        case "int8": {
          dv.setInt8(offset, data[dataPosition]);
          offset += 1;
          break;
        }
        case "int16": {
          dv.setInt16(offset, data[dataPosition]);
          offset += 2;
          break;
        }
        case "int32": {
          dv.setInt32(offset, data[dataPosition]);
          offset += 4;
          break;
        }
        case "float32": {
          dv.setFloat32(offset, data[dataPosition]);
          offset += 4;
          break;
        }
        case "int64": {
          dv.setInt64(offset, data[dataPosition]);
          offset += 8;
          break;
        }
  
        case "float32array": {
          dv.setInt32(offset, data[dataPosition].length);
          offset += 4;
          for (let j = 0; j < data[dataPosition].length; j++) {
            dv.setFloat32(offset, data[dataPosition][j]);
            offset += 4;
          }
          break;
        }
  
        case "float32arrayarray": {
          dv.setInt32(offset, data[dataPosition].length);
          offset += 4;
          for (let j = 0; j < data[dataPosition].length; j++) {
            dv.setInt32(offset, data[dataPosition][j].length);
            offset += 4;
            for (let k = 0; k < data[dataPosition][j].length; k++) {
              dv.setFloat32(offset, data[dataPosition][j][k]);
              offset += 4;
            }
          }
          break;
        }
  
        case "string": {
          let usedString = encodeURIComponent(data[dataPosition]);
          for (let j = 0; j < usedString.length; j++) {
            dv.setInt8(offset, usedString.charCodeAt(j) < 128 ? usedString.charCodeAt(j) : 63);
            offset++;
          }
          dv.setInt8(offset, 0);
          offset++;
          break;
        }
  
          // breaks down all data types between this and end a certain number of times
        case "repeat": {
          dv.setInt32(offset, data[dataPosition]);
          offset += 8;
          repeating.push([data[dataPosition], i]);
          if (data[dataPosition] === 0) zeroRepeats = true;
          break;
        }
  
        case "end": {
          zeroRepeats = false;
          for (let a = 0; a < 99; a++) {
            repeating[repeating.length - 1][0]--;
            if (repeating[repeating.length - 1][0] <= 0) {
              repeating.splice(repeating.length - 1, 1);
              break;
            }
            else {
              i = repeating[repeating.length - 1][1];
              dataPosition--;
            }
            break;
          }
          break;
        }
      }
      dataPosition++;
    }
    
    return encoded;
  }