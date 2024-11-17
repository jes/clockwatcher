#include <Arduino.h>

// Pins
const uint8_t pinA = D5;
const uint8_t pinB = D8;

// Global variables for ISR communication
volatile uint32_t lastTimestamp = 0;    // Last observed timestamp
volatile uint8_t lastDirection = 0;     // Last observed direction
volatile uint8_t collisionCount = 0;    // Tracks missed readings
volatile bool newData = false;          // Flag for new data available

volatile uint8_t lastState = 0;

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
    
    // Instead of buffer, update globals
    if (newData) {
        // Previous data wasn't processed yet
        collisionCount++;
    }
    
    lastTimestamp = micros();
    lastDirection = direction;
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
        } else {
            // Normal data transmission
            uint32_t timestamp = lastTimestamp;
            uint8_t dir = lastDirection;
            
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
        }
        newData = false;
    }
}
