#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <DHT.h>
#include <BH1750.h>
#include <LiquidCrystal_I2C.h>

#define WIFI_SSID "YBT"
#define WIFI_PASSWORD "300920055"
#define DATABASE_URL "https://dht11-5a4d9-default-rtdb.firebaseio.com"

#define DHT_PIN 33
#define DHT_TYPE DHT22

#define BH1750_SDA 21
#define BH1750_SCL 22

#define LCD_SDA 18
#define LCD_SCL 19

#define LED_PIN 25
#define AIN1 26
#define AIN2 27

#define TEMP_FAN_THRESHOLD 30.0
#define HUM_PUMP_THRESHOLD 75.0
#define LIGHT_LAMP_THRESHOLD 700.0

#define FAN_PWM 170
#define SENSOR_INTERVAL 2000
#define MANUAL_INTERVAL 1500
#define HTTP_TIMEOUT 4000

DHT dht(DHT_PIN, DHT_TYPE);
BH1750 lightMeter;
TwoWire I2C_BH1750 = TwoWire(1);
LiquidCrystal_I2C lcd(0x27, 16, 2);

unsigned long lastSensorSend = 0;
unsigned long lastManualRead = 0;

int counter = 0;

bool fanDisabled = false, pumpDisabled = false, lampDisabled = false;
bool fanOn = false, pumpOn = false, lampOn = false;
bool fanAuto = false, pumpAuto = false, lampAuto = false;
bool sensorReady = false;

float lastTemp = 0, lastHum = 0, lastLux = 0;

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.print("Dang ket noi WiFi");

  for (int i = 0; WiFi.status() != WL_CONNECTED && i < 40; i++) {
    Serial.print(".");
    delay(500);
  }

  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("Da ket noi WiFi");
    Serial.print("IP ESP32: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("Ket noi WiFi that bai");
  }
}

void setFan(bool on) {
  analogWrite(AIN1, on ? FAN_PWM : 0);
  digitalWrite(AIN2, LOW);
}

void setLamp(bool on) {
  digitalWrite(LED_PIN, on ? HIGH : LOW);
}

void updateLCDPumpOnly() {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print(pumpOn ? "May bom: BAT" : "May bom: TAT");
}

void applyOutputs() {
  if (!sensorReady) return;

  fanOn = fanAuto && !fanDisabled;
  pumpOn = pumpAuto && !pumpDisabled;
  lampOn = lampAuto && !lampDisabled;

  setFan(fanOn);
  setLamp(lampOn);
  updateLCDPumpOnly();
}

bool firebaseRequest(String method, String path, String body, String &response) {
  connectWiFi();

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Mat WiFi, khong lam viec voi Firebase duoc");
    return false;
  }

  WiFiClientSecure secureClient;
  secureClient.setInsecure();

  HTTPClient http;
  String url = String(DATABASE_URL) + path + ".json";

  if (!http.begin(secureClient, url)) {
    Serial.println("http.begin that bai");
    return false;
  }

  http.setTimeout(HTTP_TIMEOUT);
  http.setReuse(false);

  int code;

  if (method == "PUT") {
    http.addHeader("Content-Type", "application/json");
    code = http.PUT(body);
  } else {
    code = http.GET();
  }

  response = http.getString();

  Serial.print(method);
  Serial.print(" ");
  Serial.print(path);
  Serial.print(" -> ");
  Serial.println(code);

  if (response.length()) {
    Serial.println(response);
  }

  http.end();
  return code == 200;
}

bool firebasePut(String path, String json) {
  String response;
  return firebaseRequest("PUT", path, json, response);
}

String firebaseGet(String path) {
  String response;
  firebaseRequest("GET", path, "", response);
  response.trim();
  return response;
}

String devJson(bool on, int value, String mode, String reason) {
  return "{\"on\":" + String(on ? 1 : 0) +
         ",\"value\":" + String(value) +
         ",\"mode\":\"" + mode +
         "\",\"reason\":\"" + reason + "\"}";
}

String reasonText(String device, bool disabled, bool on) {
  if (device == "fan") {
    if (disabled) return "Quat da tat bang nut tren dashboard";
    return on ? "Nhiet do tren 30 do C nen quat dang bat voi PWM 170"
              : "Nhiet do chua vuot 30 do C nen quat tat";
  }

  if (device == "pump") {
    if (disabled) return "May bom da tat bang nut tren dashboard";
    return on ? "Do am duoi 75 phan tram nen may bom dang bat"
              : "Do am chua thap hon 75 phan tram nen may bom tat";
  }

  if (disabled) return "Den LED da tat bang nut tren dashboard";
  return on ? "Anh sang duoi 700 lux nen den LED dang bat"
            : "Anh sang chua thap hon 700 lux nen den LED tat";
}

String buildDevicesJson() {
  String fanMode = fanDisabled ? "MANUAL_OFF" : "AUTO";
  String pumpMode = pumpDisabled ? "MANUAL_OFF" : "AUTO";
  String lampMode = lampDisabled ? "MANUAL_OFF" : "AUTO";

  String json = "{";
  json += "\"fan\":" + devJson(fanOn, fanOn ? FAN_PWM : 0, fanMode, reasonText("fan", fanDisabled, fanOn)) + ",";
  json += "\"pump\":" + devJson(pumpOn, pumpOn ? 100 : 0, pumpMode, reasonText("pump", pumpDisabled, pumpOn)) + ",";
  json += "\"lamp\":" + devJson(lampOn, lampOn ? 100 : 0, lampMode, reasonText("lamp", lampDisabled, lampOn));
  json += "}";

  return json;
}

void sendDevicesToFirebase() {
  firebasePut("/smartGarden/devices", buildDevicesJson());
}

void sendDataToFirebase() {
  counter++;

  String dataJson = "{";
  dataJson += "\"NhietDo\":" + String(lastTemp, 1) + ",";
  dataJson += "\"DoAm\":" + String(lastHum, 1) + ",";
  dataJson += "\"AnhSang\":" + String(lastLux, 1) + ",";
  dataJson += "\"AnhSangLux\":" + String(lastLux, 1) + ",";
  dataJson += "\"status\":\"online\",";
  dataJson += "\"uptime\":" + String(millis()) + ",";
  dataJson += "\"counter\":" + String(counter);
  dataJson += "}";

  bool ok1 = firebasePut("/smartGarden/data", dataJson);
  bool ok2 = firebasePut("/smartGarden/devices", buildDevicesJson());

  Serial.println(ok1 && ok2 ? "Gui Firebase thanh cong" : "Gui Firebase that bai");
}

void readManualControl() {
  bool oldFan = fanDisabled;
  bool oldPump = pumpDisabled;
  bool oldLamp = lampDisabled;

  String payload = firebaseGet("/smartGarden/manual");

  if (payload.length() == 0) {
    Serial.println("Khong doc duoc manual, giu trang thai cu");
    return;
  }

  fanDisabled = payload != "null" && payload.indexOf("\"fanDisabled\":true") >= 0;
  pumpDisabled = payload != "null" && payload.indexOf("\"pumpDisabled\":true") >= 0;
  lampDisabled = payload != "null" && payload.indexOf("\"lampDisabled\":true") >= 0;

  if (oldFan != fanDisabled || oldPump != pumpDisabled || oldLamp != lampDisabled) {
    Serial.println("Lenh dashboard thay doi");
    applyOutputs();
    sendDevicesToFirebase();
  }
}

void readSensors() {
  float temp = dht.readTemperature();
  float hum = dht.readHumidity();
  float lux = lightMeter.readLightLevel();

  if (isnan(temp) || isnan(hum)) {
    Serial.println("Loi doc DHT22");
    return;
  }

  if (lux < 0) {
    Serial.println("Loi doc BH1750");
    return;
  }

  lastTemp = temp;
  lastHum = hum;
  lastLux = lux;

  sensorReady = true;

  fanAuto = lastTemp > TEMP_FAN_THRESHOLD;
  pumpAuto = lastHum < HUM_PUMP_THRESHOLD;
  lampAuto = lastLux < LIGHT_LAMP_THRESHOLD;

  applyOutputs();
  sendDataToFirebase();

  Serial.print("Nhiet do: ");
  Serial.print(lastTemp);
  Serial.print(" C | Do am: ");
  Serial.print(lastHum);
  Serial.print(" % | Anh sang: ");
  Serial.print(lastLux);
  Serial.print(" lux | Quat: ");
  Serial.print(fanOn ? "BAT" : "TAT");
  Serial.print(" | Bom LCD: ");
  Serial.print(pumpOn ? "BAT" : "TAT");
  Serial.print(" | Den: ");
  Serial.println(lampOn ? "BAT" : "TAT");
}

void scanI2C(TwoWire &bus, String name) {
  Serial.println("Quet I2C " + name);

  for (byte address = 1; address < 127; address++) {
    bus.beginTransmission(address);

    if (bus.endTransmission() == 0) {
      Serial.print("Tim thay ");
      Serial.print(name);
      Serial.print(" tai 0x");

      if (address < 16) Serial.print("0");
      Serial.println(address, HEX);
    }
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("BAT DAU SMART GARDEN");

  dht.begin();

  Wire.begin(LCD_SDA, LCD_SCL);
  I2C_BH1750.begin(BH1750_SDA, BH1750_SCL);

  pinMode(AIN1, OUTPUT);
  pinMode(AIN2, OUTPUT);
  pinMode(LED_PIN, OUTPUT);

  setFan(false);
  setLamp(false);

  lcd.init();
  lcd.backlight();
  updateLCDPumpOnly();

  scanI2C(Wire, "LCD");
  scanI2C(I2C_BH1750, "BH1750");

  if (lightMeter.begin(BH1750::CONTINUOUS_HIGH_RES_MODE, 0x23, &I2C_BH1750)) {
    Serial.println("BH1750 OK 0x23");
  } else if (lightMeter.begin(BH1750::CONTINUOUS_HIGH_RES_MODE, 0x5C, &I2C_BH1750)) {
    Serial.println("BH1750 OK 0x5C");
  } else {
    Serial.println("Khong tim thay BH1750");
  }

  connectWiFi();
  readManualControl();
  readSensors();
}

void loop() {
  unsigned long now = millis();

  if (now - lastSensorSend >= SENSOR_INTERVAL) {
    lastSensorSend = now;
    readSensors();
  }

  if (now - lastManualRead >= MANUAL_INTERVAL) {
    lastManualRead = now;
    readManualControl();
  }
}