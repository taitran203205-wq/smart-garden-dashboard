let db, dataRef;
let lineChart = null, barChart = null, pieChart = null;
let lastSensor = null;

const $ = id => document.getElementById(id);
const devices = ["fan", "pump", "lamp"];

const lim = {
  tempFan: 30,
  humPump: 75,
  lightLamp: 700
};

const manual = {
  fanDisabled: false,
  pumpDisabled: false,
  lampDisabled: false
};

const lastDeviceData = {
  fan: {},
  pump: {},
  lamp: {}
};

const deviceText = {
  fan: {
    name: "Quạt",
    disabled: "Quạt đã tắt bằng nút trên dashboard.",
    on: "Nhiệt độ vượt 30°C nên quạt đang bật.",
    off: "Nhiệt độ chưa vượt 30°C nên quạt đang tắt."
  },
  pump: {
    name: "Máy bơm",
    disabled: "Máy bơm đã tắt bằng nút trên dashboard.",
    on: "Độ ẩm thấp hơn 75% nên máy bơm đang bật.",
    off: "Độ ẩm chưa thấp hơn 75% nên máy bơm đang tắt."
  },
  lamp: {
    name: "Đèn",
    disabled: "Đèn LED đã tắt bằng nút trên dashboard.",
    on: "Ánh sáng thấp hơn 700 lux nên đèn đang bật.",
    off: "Ánh sáng chưa thấp hơn 700 lux nên đèn đang tắt."
  }
};

const pad = n => String(n).padStart(2, "0");

const clamp = (v, min, max) => {
  v = Number(v);
  return isNaN(v) ? min : Math.min(max, Math.max(min, v));
};

const round1 = v => Math.round(Number(v) * 10) / 10;

function setText(id, text) {
  const el = $(id);
  if (el) el.innerText = text;
}

function setStatus(id, cls, text) {
  const el = $(id);
  if (!el) return;
  el.className = "badge " + cls;
  el.innerText = text;
}

function clock() {
  const d = new Date();
  setText("time", `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`);
  setText("date", `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`);
}

function makeDataset(label, color) {
  return {
    label,
    data: [],
    borderColor: color,
    backgroundColor: color,
    borderWidth: 3,
    tension: .4,
    fill: false
  };
}

function commonChartOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 100 },
    plugins: {
      legend: {
        labels: {
          boxWidth: 12,
          font: { weight: "bold" }
        }
      }
    },
    scales: {
      y: {
        min: 0,
        max: 100,
        ticks: { stepSize: 20 }
      }
    }
  };
}

function initCharts() {
  if (typeof Chart === "undefined") {
    console.warn("Chart.js chưa tải được, cảm biến vẫn hoạt động.");
    return;
  }

  if (!$("lineChart") || !$("barChart") || !$("pieChart")) {
    console.warn("Không tìm thấy canvas biểu đồ.");
    return;
  }

  lineChart = new Chart($("lineChart"), {
    type: "line",
    data: {
      labels: [],
      datasets: [
        makeDataset("Nhiệt độ (°C)", "#16a34a"),
        makeDataset("Độ ẩm (%)", "#3b82f6"),
        makeDataset("Ánh sáng (lux/10)", "#f2b705")
      ]
    },
    options: commonChartOptions()
  });

  barChart = new Chart($("barChart"), {
    type: "bar",
    data: {
      labels: ["Nhiệt độ", "Độ ẩm", "Ánh sáng/10"],
      datasets: [{
        label: "Giá trị hiện tại",
        data: [0, 0, 0],
        backgroundColor: ["#16a34a", "#3b82f6", "#f2b705"],
        borderRadius: 10
      }]
    },
    options: commonChartOptions()
  });

  pieChart = new Chart($("pieChart"), {
    type: "pie",
    data: {
      labels: ["Nhiệt độ", "Độ ẩm", "Ánh sáng/10"],
      datasets: [{
        data: [1, 1, 1],
        backgroundColor: ["#16a34a", "#3b82f6", "#f2b705"],
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 100 },
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            boxWidth: 12,
            font: { weight: "bold" }
          }
        }
      }
    }
  });
}

function updateCharts(d) {
  if (!lineChart || !barChart || !pieChart) return;

  const now = new Date();
  const label = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const light10 = round1(d.lightLux / 10);

  lineChart.data.labels.push(label);
  [d.temp, d.hum, light10].forEach((v, i) => lineChart.data.datasets[i].data.push(v));

  if (lineChart.data.labels.length > 15) {
    lineChart.data.labels.shift();
    lineChart.data.datasets.forEach(ds => ds.data.shift());
  }

  lineChart.update();

  barChart.data.datasets[0].data = [d.temp, d.hum, light10];
  barChart.update();

  pieChart.data.datasets[0].data = [
    Math.max(d.temp, 1),
    Math.max(d.hum, 1),
    Math.max(light10, 1)
  ];
  pieChart.update();
}

function parseSensor(raw = {}) {
  return {
    temp: round1(clamp(raw.NhietDo ?? raw.Nhietdo ?? raw.temperature ?? raw.temp, -20, 80)),
    hum: round1(clamp(raw.DoAm ?? raw.Doam ?? raw.humidity ?? raw.hum, 0, 100)),
    lightLux: round1(clamp(raw.AnhSangLux ?? raw.AnhSang ?? raw.lux ?? raw.lightLux ?? raw.light, 0, 200000)),
    uptime: raw.uptime || 0,
    counter: raw.counter || 0,
    status: raw.status || "online"
  };
}

function isDisabled(name) {
  return manual[name + "Disabled"] === true;
}

function autoOn(name) {
  if (!lastSensor) return Number(lastDeviceData[name]?.on) === 1;
  if (name === "fan") return lastSensor.temp > lim.tempFan;
  if (name === "pump") return lastSensor.hum < lim.humPump;
  if (name === "lamp") return lastSensor.lightLux < lim.lightLamp;
  return false;
}

function deviceActive(name) {
  return !isDisabled(name) && autoOn(name);
}

function renderDevice(name) {
  const disabled = isDisabled(name);
  const active = deviceActive(name);
  const state = $(name + "State");
  const reason = $(name + "Reason");
  const onBtn = $(name + "On");
  const offBtn = $(name + "Off");

  if (state) {
    state.innerText = active ? "ONLINE" : "OFF";
    state.className = "device-status " + (active ? "on" : disabled ? "manual-off" : "off");
  }

  if (reason) {
    reason.innerText = disabled
      ? deviceText[name].disabled
      : active
        ? deviceText[name].on
        : deviceText[name].off;
  }

  if (onBtn && offBtn) {
    onBtn.className = "device-btn on-btn " + (!disabled ? "active-control" : "inactive");
    offBtn.className = "device-btn off-btn " + (disabled ? "active-control" : "inactive");
  }
}

function setManual(name, disabled) {
  if (!db) return;

  const key = name + "Disabled";
  manual[key] = disabled === true;
  renderDevice(name);

  db.ref(`smartGarden/manual/${key}`).set(manual[key]).catch(err => {
    setStatus("firebaseStatus", "bad-text", "LỖI GHI FIREBASE");
    setText("noticeTitle", "Không ghi được lệnh điều khiển");
    setText("noticeText", err.message);
  });
}

function updateSensorUI(d) {
  const fanAuto = d.temp > lim.tempFan;
  const pumpAuto = d.hum < lim.humPump;
  const lampAuto = d.lightLux < lim.lightLamp;
  const active = fanAuto || pumpAuto || lampAuto;

  setText("temp", `${d.temp} °C`);
  setText("hum", `${d.hum} %`);
  setText("light", `${d.lightLux} lux`);

  setStatus("tempStatus", fanAuto ? "bad-text" : "ok", fanAuto ? "NÓNG" : "ỔN ĐỊNH");
  setStatus("humStatus", pumpAuto ? "bad-text" : "ok", pumpAuto ? "KHÔ" : "ỔN ĐỊNH");
  setStatus("lightStatus", lampAuto ? "bad-text" : "ok", lampAuto ? "THIẾU SÁNG" : "ỔN ĐỊNH");

  const notice = $("notice");
  if (notice) notice.className = "notice " + (active ? "bad" : "good");

  setText(
    "noticeTitle",
    active ? "Hệ thống đang tự động xử lý môi trường" : "Khu vườn đang ở trạng thái ổn định"
  );

  const actions = [];
  if (fanAuto) actions.push("quạt cần bật vì nhiệt độ lớn hơn 30°C");
  if (pumpAuto) actions.push("máy bơm cần bật vì độ ẩm thấp hơn 75%");
  if (lampAuto) actions.push("đèn cần bật vì ánh sáng thấp hơn 700 lux");

  setText(
    "noticeText",
    `Nhiệt độ ${d.temp}°C, độ ẩm ${d.hum}%, ánh sáng ${d.lightLux} lux. ` +
    (actions.length ? actions.join(", ") + "." : "Các thông số đang ổn định.")
  );

  setStatus("firebaseStatus", "ok", "FIREBASE ĐÃ KẾT NỐI");
}

function listenManual() {
  db.ref("smartGarden/manual").on("value", snapshot => {
    const d = snapshot.val() || {};

    devices.forEach(name => {
      manual[name + "Disabled"] = d[name + "Disabled"] === true;
      renderDevice(name);
    });
  }, err => console.error("Manual error:", err));
}

function listenDevices() {
  devices.forEach(name => {
    db.ref(`smartGarden/devices/${name}`).on("value", snapshot => {
      lastDeviceData[name] = snapshot.val() || {};
      renderDevice(name);
    }, err => console.error(`Device ${name} error:`, err));
  });
}

function listenSensor() {
  dataRef.on("value", snapshot => {
    if (!snapshot.exists()) {
      setStatus("firebaseStatus", "warning-text", "CHƯA CÓ DỮ LIỆU");

      const notice = $("notice");
      if (notice) notice.className = "notice warning";

      setText("noticeTitle", "Chưa có dữ liệu từ ESP32");
      setText("noticeText", "Kiểm tra Serial Monitor, WiFi, Firebase URL và đường dẫn /smartGarden/data.");
      return;
    }

    lastSensor = parseSensor(snapshot.val() || {});
    updateSensorUI(lastSensor);
    devices.forEach(renderDevice);
    updateCharts(lastSensor);
  }, err => {
    setStatus("firebaseStatus", "bad-text", "LỖI FIREBASE");

    const notice = $("notice");
    if (notice) notice.className = "notice bad";

    setText("noticeTitle", "Không đọc được Firebase");
    setText("noticeText", err.message);
  });
}

function startApp() {
  clock();
  setInterval(clock, 1000);

  if (typeof firebase === "undefined") {
    setStatus("firebaseStatus", "bad-text", "THIẾU FIREBASE SDK");

    const notice = $("notice");
    if (notice) notice.className = "notice bad";

    setText("noticeTitle", "Không tải được Firebase SDK");
    setText("noticeText", "Máy cần Internet để tải Firebase SDK.");
    return;
  }

  db = firebase.database();
  dataRef = db.ref("smartGarden/data");

  initCharts();
  listenManual();
  listenDevices();
  listenSensor();
}

document.readyState === "loading"
  ? document.addEventListener("DOMContentLoaded", startApp)
  : startApp();