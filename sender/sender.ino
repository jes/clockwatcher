#include <Arduino.h>

// Pins
const uint8_t pinA = D5;
const uint8_t pinB = D8;

// Global variables for ISR communication
volatile uint8_t collisionCount = 0;    // Tracks missed readings
volatile bool newData = false;          // Flag for new data available

volatile uint8_t lastState = 0;

// Define buffer structure
const uint16_t BUFFER_SIZE = 100;
struct Reading {
    uint32_t timestamp;
    uint8_t direction;
};
volatile Reading buffer[BUFFER_SIZE];
volatile uint16_t writeIndex = 0;
volatile uint16_t readIndex = 0;
volatile bool bufferFull = false;

void IRAM_ATTR handleEncoder() {
    uint8_t stateA = digitalRead(pinA);
    uint8_t stateB = digitalRead(pinB);
    uint8_t currentState = (stateA << 1) | stateB;

    uint8_t direction = 0;
    
    // State transition table for clockwise rotation:
    // 00 -> 01 -> 11 -> 10 -> 00
    switch (lastState << 2 | currentState) {
        // Clockwise cases
        case 0b0001: // 00 -> 01
        case 0b0111: // 01 -> 11
        case 0b1110: // 11 -> 10
        case 0b1000: // 10 -> 00
            direction = 1;
            break;
            
        // Counter-clockwise cases
        case 0b0010: // 00 -> 10
        case 0b1011: // 10 -> 11
        case 0b1101: // 11 -> 01
        case 0b0100: // 01 -> 00
            direction = 0;
            break;
            
        default:
            // Invalid state transition or no movement
            return;
    }
    
    lastState = currentState;
    
    // Update buffer instead of single variables
    uint16_t nextIndex = (writeIndex + 1) % BUFFER_SIZE;
    if (nextIndex == readIndex) {
        // Buffer is full
        collisionCount++;
        return;
    }
    
    buffer[writeIndex].timestamp = micros();
    buffer[writeIndex].direction = direction;
    writeIndex = nextIndex;
    newData = true;
}

void setup() {
    pinMode(pinA, INPUT);
    pinMode(pinB, INPUT);

    attachInterrupt(digitalPinToInterrupt(pinA), handleEncoder, CHANGE);
    attachInterrupt(digitalPinToInterrupt(pinB), handleEncoder, CHANGE);

    Serial.begin(115200);
}

void loop() {
    if (newData) {
        if (collisionCount > 0) {
            // Send overflow marker (5 bytes of 0xFF)
            for (int i = 0; i < 5; i++) {
                Serial.write(0xFF);
            }
            collisionCount--;
        } else if (readIndex != writeIndex) {  // Check if there's data to read
            // Normal data transmission
            uint32_t timestamp = buffer[readIndex].timestamp;
            uint8_t dir = buffer[readIndex].direction;
            
            // Calculate checksum byte by byte
            uint8_t checksum = 0;
            uint8_t bytes[4];
            bytes[0] = (timestamp >> 24) & 0xFF;
            bytes[1] = (timestamp >> 16) & 0xFF;
            bytes[2] = (timestamp >> 8) & 0xFF;
            bytes[3] = timestamp & 0xFF;
            
            for (int i = 0; i < 4; i++) {
                checksum ^= bytes[i];
            }
            checksum &= 0x7F;
            
            uint8_t finalByte = (dir << 7) | checksum;

            // Send the data
            for (int i = 0; i < 4; i++) {
                Serial.write(bytes[i]);
            }
            Serial.write(finalByte);
            
            readIndex = (readIndex + 1) % BUFFER_SIZE;
        }
        
        if (readIndex == writeIndex) {
            newData = false;  // Buffer is empty
        }
    }
}
