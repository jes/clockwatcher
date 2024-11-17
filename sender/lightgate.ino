#include <Arduino.h>

// Pins
const uint8_t pinA = D5;
const uint8_t pinB = D8;

// Buffer settings
const uint16_t BUFFER_SIZE = 128; // Adjust as needed
volatile uint32_t buffer[BUFFER_SIZE]; // Circular buffer
volatile uint16_t bufferHead = 0;
volatile uint16_t bufferTail = 0;
volatile bool overflowFlag = false; // Tracks overflow state

// Variables
volatile uint32_t lastMicros = 0; // Last timestamp
volatile int32_t position = 0;    // Encoder position
volatile uint8_t direction = 0;   // Direction of motion (1 = positive, 0 = negative)

void IRAM_ATTR handleEncoder() {
    uint32_t currentMicros = micros();
    uint8_t stateA = digitalRead(pinA);
    uint8_t stateB = digitalRead(pinB);

    // Determine direction
    if (stateA == stateB) {
        direction = 1; // Positive
        position++;
    } else {
        direction = 0; // Negative
        position--;
    }

    // Pack timestamp and direction
    uint32_t packedData = (currentMicros & 0x7FFFFFFF) | (direction << 31);

    // Store data in the buffer
    uint16_t nextHead = (bufferHead + 1) % BUFFER_SIZE;
    if (nextHead != bufferTail) { // Check for overflow
        buffer[bufferHead] = packedData;
        bufferHead = nextHead;
    } else {
        // Buffer overflow - indicate this by sending "all 1s"
        buffer[bufferHead] = 0xFFFFFFFF; // Overflow marker
    }
}

void setup() {
    pinMode(pinA, INPUT);
    pinMode(pinB, INPUT);

    attachInterrupt(digitalPinToInterrupt(pinA), handleEncoder, CHANGE);
    attachInterrupt(digitalPinToInterrupt(pinB), handleEncoder, CHANGE);

    Serial.begin(115200);
}

void loop() {
    // Check if buffer has data
    while (bufferHead != bufferTail) {
        // Retrieve data from the buffer
        uint32_t data = buffer[bufferTail];
        bufferTail = (bufferTail + 1) % BUFFER_SIZE;

        // Send data over USB Serial
        Serial.write((data >> 24) & 0xFF); // Most significant byte
        Serial.write((data >> 16) & 0xFF);
        Serial.write((data >> 8) & 0xFF);
        Serial.write(data & 0xFF);         // Least significant byte
    }
}
