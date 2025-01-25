require("dotenv").config();

const { decryptAES, decodeBase64, atuwokzDecode } = require("./decrypter");
const express = require("express");
const cors = require("cors");
const sql = require("mssql");
const compression = require("compression");
const app = express();
const fs = require("fs");
const path = require("path");
const moment = require("moment-timezone");
const NodeCache = require("node-cache");
// ============================ New Haikal
const ChaceTempSAve = require("redis");

const { parse } = require("json2csv");
const fsCSV = require("fs");
const { promises, Resolver } = require("dns");
//============================= End

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(compression());
const myCache = new NodeCache();
const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  options: {
    //encrypt: true,
    trustServerCertificate: true,
    //port: process.env.DB_PORT
  },
};
clearAllCache(); //-delete all cache ketika di nyalakan
function clearAllCache() {
  myCache.flushAll();
  // console.log("All cache has been cleared.");
}

//-- untuk debug tinggal panggil
function writeLog(message) {
  const timestamp = new Date().toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const logMessage = `[${timestamp}] ${message}\n`;
  fs.appendFileSync("log.txt", logMessage, { encoding: "utf8" });
}

async function retryOperation(operation, retries = 10000, delay = 10000) {
  let attempt = 0;
  while (attempt < retries) {
    try {
      return await operation();
    } catch (error) {
      attempt++;
      console.error(
        `Operation failed (attempt ${attempt}/${retries}): ${error.message}`
      );
      if (attempt >= retries) {
        throw new Error(
          `Operation failed after ${retries} attempts: ${error.message}`
        );
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

let connectionPool;
let sanitizedTableNamesCache = null;
let floorTableMap = null;

async function initializeConnectionPool(retries = 5, delay = 3000) {
  let attempt = 0;
  while (attempt < retries) {
    try {
      connectionPool = await sql.connect(dbConfig);
      console.log("Database connected and connection pool created.");
      await initializeTableCache();
      return;
    } catch (err) {
      attempt++;
      console.error(
        `Database connection failed. Attempt: ${attempt}. Retries left: ${
          retries - attempt
        }. Error: ${err.message}`
      );
      if (attempt >= retries) {
        console.error("Max retries reached. Could not establish a connection.");
        break;
      }
      console.log(`Retrying in ${delay / 1000} seconds...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

//initializeTableCache for lantai + dashboard
async function initializeTableCache() {
  floorTableMap = {
    lantai1: "tbl_lantai_1",
    lantai1_annex: "tbl_lantai_1_annex",
    lantai2: "tbl_lantai_2",
    lantai2_annex: "tbl_lantai_2_annex",
    lantai3: "tbl_lantai_3",
    lantai3_annex: "tbl_lantai_3_annex",
    lantai4: "tbl_lantai_4",
    lantai5: "tbl_lantai_5",
    lantai6: "tbl_lantai_6",
    lantai7: "tbl_lantai_7",
    lantai8: "tbl_lantai_8",
    lantaiEksternal: "tbl_eksternal",
    lantaiGround: "tbl_lantai_ground",
  };

  try {
    const queries = Object.entries(floorTableMap).map(([key, tableName]) => {
      return `SELECT '${key}' AS floor, no_kWh_Meter, nama_kWh_Meter FROM ${tableName} WHERE no_kWh_Meter != '8' AND no_kWh_Meter != '60'`; //exclude plts dan genset
    });

    const combinedQuery = queries.join(" UNION ALL ");

    const result = await connectionPool.request().query(combinedQuery);
    const kwhMeters = result.recordset;

    // console.log(`ZAZAZ`,kwhMeters);

    sanitizedTableNamesCache = Array.from(
      new Set(
        kwhMeters.map((meter) => {
          const sanitizedName = meter.nama_kWh_Meter.replace(
            /[^a-zA-Z0-9_]/g,
            "_"
          );
          return `tbl_log_${sanitizedName}`;
        })
      )
    );
  } catch (err) {
    console.error("Failed to initialize table cache:", err.message);
    throw err;
  }
}

//===================== Global

// setInterval(() => getDataDashboard("hour"), 5000);
// ==================== END

//====================== New Dashboard

async function NewCalcDash() {
  try {
    const formattedDate = moment()
      .tz("Asia/Jakarta")
      .format("YYYY-MM-DD HH:mm:ss.SSS");

    console.log(formattedDate);
  } catch (err) {
    console.error(err);
    const errorData = {
      success: false,
      message: `Error processing data: ${err.message}`,
    };
  }
}

async function getDataDashboard(inputxx) {
  try {
    const request = new sql.Request(connectionPool);
    const result = await retryOperation(async () =>
      request.query(
        `SELECT TOP 1 emission_factor, lbwp, wbp, total_cost_limit, kvarh
          FROM tbl_set_value
          ORDER BY id DESC`
      )
    );
    if (!result.recordset.length) {
      const errorData = {
        success: false,
        message: "Configuration data not found in the database.",
      };
      myCache.set("dashboardData", errorData);
      return;
    }
    const { emission_factor, lbwp, wbp, total_cost_limit, kvarh } =
      result.recordset[0];
    const EMISSION_FACTOR = parseFloat(emission_factor);
    const TARIFFS = {
      LWBP: parseFloat(lbwp),
      WBP: parseFloat(wbp),
      kvarh: parseFloat(kvarh),
    };
    const totalCostLimit = parseFloat(total_cost_limit);
    const thresholds = {
      perMonth: totalCostLimit / (TARIFFS.LWBP * 0.7917 + TARIFFS.WBP * 0.2083),
    };

    thresholds.perDay = thresholds.perMonth / 30;
    thresholds.perHour = thresholds.perDay / 24;
    thresholds.perMinute = thresholds.perHour / 60;
    thresholds.perYear = thresholds.perMonth * 12;

    const calculateDerivedThresholds = (value) => ({
      energyConsume: value,
      energyConsumeAktual: value * 1.6,
      emission: value * EMISSION_FACTOR,
    });

    const thresholdData = {
      perMinute: calculateDerivedThresholds(thresholds.perMinute),
      perHour: calculateDerivedThresholds(thresholds.perHour),
      perDay: calculateDerivedThresholds(thresholds.perDay),
      perMonth: calculateDerivedThresholds(thresholds.perMonth),
      perYear: calculateDerivedThresholds(thresholds.perYear),
    };

    if (!sanitizedTableNamesCache) await initializeTableCache();
    const timestamp = new Date().toLocaleString("id-ID", {
      timeZone: "Asia/Jakarta",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    console.log(`[Running Calculate Dashboard -- [${timestamp}]`);
    const logs = [];

    const getElectricityTariff = (dateTime, pfAvg) => {
      const hour = new Date(dateTime).getHours();
      let tariff = hour >= 23 || hour < 17 ? TARIFFS.LWBP : TARIFFS.WBP;
      if (pfAvg < 0.85) {
        tariff += TARIFFS.kvarh;
      }
      return tariff;
    };

    if (inputxx === "hourly") {
      console.log(`ZAZAZ`);
    } else {
      await Promise.all(
        sanitizedTableNamesCache.map((tableName) =>
          retryOperation(
            () =>
              new Promise((resolve, reject) => {
                const request = new sql.Request(connectionPool);
                request.stream = true;
                request.query(
                  `SELECT TOP(60) CONVERT(VARCHAR(19), log_waktu, 120) AS log_waktu, v_avg, I_avg, kVA, kW, kVArh, PF_avg, no_kWh_Meter
                    FROM ${tableName}
                    ORDER BY log_waktu DESC`
                );
                request.on("row", (row) => {
                  const decryptedRow = { ...row };
                  ["kVA", "kW", "kVArh", "PF_avg", "v_avg", "I_avg"].forEach(
                    (field) => {
                      try {
                        decryptedRow[field] = parseFloat(
                          atuwokzDecode(decodeBase64(decryptAES(row[field])))
                        );
                      } catch {
                        decryptedRow[field] = 0;
                      }
                    }
                  );

                  // ADD: Hitung cost di level log
                  const PF_avg = parseFloat(decryptedRow.PF_avg || 0);
                  const energyConsume = parseFloat(decryptedRow.kW || 0) / 60;
                  const energyConsumeActual = energyConsume * 1.6;
                  const tariff = getElectricityTariff(row.log_waktu, PF_avg);
                  const numericCost =
                    energyConsumeActual * tariff +
                    (PF_avg < 0.85 ? energyConsumeActual * TARIFFS.kvarh : 0);

                  decryptedRow.energyConsume = energyConsume;
                  decryptedRow.energyConsumeActual = energyConsumeActual;
                  decryptedRow.numericCost = numericCost; // ADD: simpan cost per log
                  logs.push(decryptedRow);
                  console.log(`ZIZIZI`, logs, decryptedRow);
                });
                request.on("error", (err) => reject(err));
                request.on("done", () => resolve());
              })
          )
        )
      );
    }

    const groupAndAggregateLogs = (granularity) => {
      const formatTimeKey = (log, granularity) => {
        const date = new Date(log.log_waktu);
        const pad = (num) => String(num).padStart(2, "0");
        const formattedTime = `${date.getFullYear()}-${pad(
          date.getMonth() + 1
        )}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
          date.getMinutes()
        )}:${pad(date.getSeconds())}`;

        switch (granularity) {
          case "minute":
            return formattedTime.slice(0, 16);
          case "hour":
            return formattedTime.slice(0, 13);
          case "day":
            return formattedTime.slice(0, 10);
          case "month":
            return formattedTime.slice(0, 7);
          case "year":
            return formattedTime.slice(0, 4);
          default:
            throw new Error("Invalid granularity");
        }
      };

      const groupedLogs = logs.reduce((acc, log) => {
        const key = formatTimeKey(log, granularity);
        acc[key] = acc[key] || [];
        acc[key].push(log);
        return acc;
      }, {});

      return Object.entries(groupedLogs).map(([time, logGroup]) => {
        const totals = logGroup.reduce(
          (sum, log) => {
            sum.kW += log.kW;
            sum.kVA += log.kVA;
            sum.kVArh += log.kVArh;
            sum.v_avg += log.v_avg;
            sum.I_avg += log.I_avg;
            sum.PF_avg += log.PF_avg;
            sum.cost += log.numericCost; // ADD: Jumlahkan cost langsung dari numericCost per log
            sum.energyConsume += log.energyConsume; // ADD: agar emission tetap sesuai
            sum.energyConsumeActual += log.energyConsumeActual;
            return sum;
          },
          {
            kW: 0,
            kVA: 0,
            kVArh: 0,
            v_avg: 0,
            I_avg: 0,
            PF_avg: 0,
            cost: 0,
            energyConsume: 0,
            energyConsumeActual: 0,
          }
        );

        const count = logGroup.length;
        const energyConsume = totals.energyConsume;
        const energyConsumeActual = totals.energyConsumeActual;
        const energyReactive = totals.kVArh / 60;
        const energyApparent = totals.kVA / 60;
        const emission = energyConsumeActual * EMISSION_FACTOR;
        // Sekarang cost sudah diakumulasi dari numericCost per log
        const totalCost = totals.cost;

        return {
          time,
          V_AVG: totals.v_avg / count,
          I_AVG: totals.I_avg / count,
          PF_AVG: totals.PF_avg / count,
          energyConsume,
          energyConsumeActual,
          energyApparent,
          energyReactive,
          emission,
          cost: new Intl.NumberFormat("id-ID", {
            style: "currency",
            currency: "IDR",
          }).format(totalCost),
        };
      });
    };

    const minuteData = groupAndAggregateLogs("minute");
    const hourlyData = groupAndAggregateLogs("hour");
    const dailyData = groupAndAggregateLogs("day");
    const monthlyData = groupAndAggregateLogs("month");
    const yearlyData = groupAndAggregateLogs("year");
    const AC_AREA = 13199.79;

    const calculateEEI = (data) =>
      data.map((entry) => ({
        ...entry,
        EEI: entry.energyConsumeActual / AC_AREA,
      }));

    const dashboardData = {
      success: true,
      data: {
        thresholds: thresholdData,
        minuteData: calculateEEI(minuteData),
        hourlyData: calculateEEI(hourlyData),
        dailyData: calculateEEI(dailyData),
        monthlyData: calculateEEI(monthlyData),
        yearlyData: calculateEEI(yearlyData),
      },
    };
    myCache.set("dashboardData", dashboardData);
  } catch (err) {
    console.error(err);
    const errorData = {
      success: false,
      message: `Error processing data: ${err.message}`,
    };
    myCache.set("dashboardData", errorData);
  }
}

async function ambilThresholdData() {
  try {
    const request = new sql.Request(connectionPool);
    const result = await retryOperation(async () =>
      request.query(
        `SELECT TOP 1 emission_factor, lbwp, wbp, total_cost_limit, kvarh
        FROM tbl_set_value
        ORDER BY id DESC`
      )
    );
    if (!result.recordset.length) {
      const errorData = {
        success: false,
        message: "Configuration data not found in the database.",
      };
      return;
    }
    const { emission_factor, lbwp, wbp, total_cost_limit, kvarh } =
      result.recordset[0];

    const EMISSION_FACTOR = parseFloat(emission_factor);
    const TARIFFS = {
      LWBP: parseFloat(lbwp),
      WBP: parseFloat(wbp),
      kvarh: parseFloat(kvarh),
    };

    const totalCostLimit = parseFloat(total_cost_limit);
    const thresholds = {
      perMonth: totalCostLimit / (TARIFFS.LWBP * 0.7917 + TARIFFS.WBP * 0.2083),
    };

    thresholds.perDay = thresholds.perMonth / 30;
    thresholds.perHour = thresholds.perDay / 24;
    thresholds.perMinute = thresholds.perHour / 60;
    thresholds.perYear = thresholds.perMonth * 12;

    const calculateDerivedThresholds = (value) => ({
      energyConsume: value,
      energyConsumeAktual: value * 1.6,
      emission: value * EMISSION_FACTOR,
    });

    const thresholdData = {
      perMinute: calculateDerivedThresholds(thresholds.perMinute),
      perHour: calculateDerivedThresholds(thresholds.perHour),
      perDay: calculateDerivedThresholds(thresholds.perDay),
      perMonth: calculateDerivedThresholds(thresholds.perMonth),
      perYear: calculateDerivedThresholds(thresholds.perYear),
    };

    if (!sanitizedTableNamesCache) await initializeTableCache();
    const timestamp = new Date().toLocaleString("id-ID", {
      timeZone: "Asia/Jakarta",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    //console.log(`[Running Calculate Dashboard -- [${timestamp}]`);
    const logs = [];

    const getElectricityTariff = (dateTime, pfAvg) => {
      const hour = new Date(dateTime).getHours();
      let tariff = hour >= 23 || hour < 17 ? TARIFFS.LWBP : TARIFFS.WBP;
      if (pfAvg < 0.85) {
        tariff += TARIFFS.kvarh;
      }
      return tariff;
    };
  } catch (err) {}
}

//====================== End

//---------START ENDPOINT "DASHOARD" (perhitungan done kan?)
async function calculateDashboard() {
  try {
    const request = new sql.Request(connectionPool);
    const result = await retryOperation(async () =>
      request.query(
        `SELECT TOP 1 emission_factor, lbwp, wbp, total_cost_limit, kvarh
        FROM tbl_set_value
        ORDER BY id DESC`
      )
    );
    if (!result.recordset.length) {
      const errorData = {
        success: false,
        message: "Configuration data not found in the database.",
      };
      myCache.set("dashboardData", errorData);
      return;
    }
    const { emission_factor, lbwp, wbp, total_cost_limit, kvarh } =
      result.recordset[0];
    const EMISSION_FACTOR = parseFloat(emission_factor);
    const TARIFFS = {
      LWBP: parseFloat(lbwp),
      WBP: parseFloat(wbp),
      kvarh: parseFloat(kvarh),
    };
    const totalCostLimit = parseFloat(total_cost_limit);
    const thresholds = {
      perMonth: totalCostLimit / (TARIFFS.LWBP * 0.7917 + TARIFFS.WBP * 0.2083),
    };

    thresholds.perDay = thresholds.perMonth / 30;
    thresholds.perHour = thresholds.perDay / 24;
    thresholds.perMinute = thresholds.perHour / 60;
    thresholds.perYear = thresholds.perMonth * 12;

    const calculateDerivedThresholds = (value) => ({
      energyConsume: value,
      energyConsumeAktual: value * 1.6,
      emission: value * EMISSION_FACTOR,
    });

    const thresholdData = {
      perMinute: calculateDerivedThresholds(thresholds.perMinute),
      perHour: calculateDerivedThresholds(thresholds.perHour),
      perDay: calculateDerivedThresholds(thresholds.perDay),
      perMonth: calculateDerivedThresholds(thresholds.perMonth),
      perYear: calculateDerivedThresholds(thresholds.perYear),
    };

    if (!sanitizedTableNamesCache) await initializeTableCache();
    const timestamp = new Date().toLocaleString("id-ID", {
      timeZone: "Asia/Jakarta",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    console.log(`[Running Calculate Dashboard -- [${timestamp}]`);
    const logs = [];

    const getElectricityTariff = (dateTime, pfAvg) => {
      const hour = new Date(dateTime).getHours();
      let tariff = hour >= 23 || hour < 17 ? TARIFFS.LWBP : TARIFFS.WBP;
      if (pfAvg < 0.85) {
        tariff += TARIFFS.kvarh;
      }
      return tariff;
    };

    await Promise.all(
      sanitizedTableNamesCache.map((tableName) =>
        retryOperation(
          () =>
            new Promise((resolve, reject) => {
              const request = new sql.Request(connectionPool);
              request.stream = true;
              request.query(
                `SELECT TOP(60) CONVERT(VARCHAR(19), log_waktu, 120) AS log_waktu, v_avg, I_avg, kVA, kW, kVArh, PF_avg, no_kWh_Meter
                FROM ${tableName}
                ORDER BY log_waktu DESC`
              );
              request.on("row", (row) => {
                const decryptedRow = { ...row };
                ["kVA", "kW", "kVArh", "PF_avg", "v_avg", "I_avg"].forEach(
                  (field) => {
                    try {
                      decryptedRow[field] = parseFloat(
                        atuwokzDecode(decodeBase64(decryptAES(row[field])))
                      );
                    } catch {
                      decryptedRow[field] = 0;
                    }
                  }
                );

                // ADD: Hitung cost di level log
                const PF_avg = parseFloat(decryptedRow.PF_avg || 0);
                const energyConsume = parseFloat(decryptedRow.kW || 0) / 60;
                const energyConsumeActual = energyConsume * 1.6;
                const tariff = getElectricityTariff(row.log_waktu, PF_avg);
                const numericCost =
                  energyConsumeActual * tariff +
                  (PF_avg < 0.85 ? energyConsumeActual * TARIFFS.kvarh : 0);

                decryptedRow.energyConsume = energyConsume;
                decryptedRow.energyConsumeActual = energyConsumeActual;
                decryptedRow.numericCost = numericCost; // ADD: simpan cost per log
                logs.push(decryptedRow);
              });
              request.on("error", (err) => reject(err));
              request.on("done", () => resolve());
            })
        )
      )
    );

    const groupAndAggregateLogs = (granularity) => {
      const formatTimeKey = (log, granularity) => {
        const date = new Date(log.log_waktu);
        const pad = (num) => String(num).padStart(2, "0");
        const formattedTime = `${date.getFullYear()}-${pad(
          date.getMonth() + 1
        )}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
          date.getMinutes()
        )}:${pad(date.getSeconds())}`;

        switch (granularity) {
          case "minute":
            return formattedTime.slice(0, 16);
          case "hour":
            return formattedTime.slice(0, 13);
          case "day":
            return formattedTime.slice(0, 10);
          case "month":
            return formattedTime.slice(0, 7);
          case "year":
            return formattedTime.slice(0, 4);
          default:
            throw new Error("Invalid granularity");
        }
      };

      const groupedLogs = logs.reduce((acc, log) => {
        const key = formatTimeKey(log, granularity);
        acc[key] = acc[key] || [];
        acc[key].push(log);
        return acc;
      }, {});

      return Object.entries(groupedLogs).map(([time, logGroup]) => {
        const totals = logGroup.reduce(
          (sum, log) => {
            sum.kW += log.kW;
            sum.kVA += log.kVA;
            sum.kVArh += log.kVArh;
            sum.v_avg += log.v_avg;
            sum.I_avg += log.I_avg;
            sum.PF_avg += log.PF_avg;
            sum.cost += log.numericCost; // ADD: Jumlahkan cost langsung dari numericCost per log
            sum.energyConsume += log.energyConsume; // ADD: agar emission tetap sesuai
            sum.energyConsumeActual += log.energyConsumeActual;
            return sum;
          },
          {
            kW: 0,
            kVA: 0,
            kVArh: 0,
            v_avg: 0,
            I_avg: 0,
            PF_avg: 0,
            cost: 0,
            energyConsume: 0,
            energyConsumeActual: 0,
          }
        );

        const count = logGroup.length;
        const energyConsume = totals.energyConsume;
        const energyConsumeActual = totals.energyConsumeActual;
        const energyReactive = totals.kVArh / 60;
        const energyApparent = totals.kVA / 60;
        const emission = energyConsumeActual * EMISSION_FACTOR;
        // Sekarang cost sudah diakumulasi dari numericCost per log
        const totalCost = totals.cost;

        return {
          time,
          V_AVG: totals.v_avg / count,
          I_AVG: totals.I_avg / count,
          PF_AVG: totals.PF_avg / count,
          energyConsume,
          energyConsumeActual,
          energyApparent,
          energyReactive,
          emission,
          cost: new Intl.NumberFormat("id-ID", {
            style: "currency",
            currency: "IDR",
          }).format(totalCost),
        };
      });
    };

    const minuteData = groupAndAggregateLogs("minute");
    const hourlyData = groupAndAggregateLogs("hour");
    const dailyData = groupAndAggregateLogs("day");
    const monthlyData = groupAndAggregateLogs("month");
    const yearlyData = groupAndAggregateLogs("year");
    const AC_AREA = 13199.79;

    const calculateEEI = (data) =>
      data.map((entry) => ({
        ...entry,
        EEI: entry.energyConsumeActual / AC_AREA,
      }));

    const dashboardData = {
      success: true,
      data: {
        thresholds: thresholdData,
        minuteData: calculateEEI(minuteData),
        hourlyData: calculateEEI(hourlyData),
        dailyData: calculateEEI(dailyData),
        monthlyData: calculateEEI(monthlyData),
        yearlyData: calculateEEI(yearlyData),
      },
    };
    myCache.set("dashboardData", dashboardData);
  } catch (err) {
    console.error(err);
    const errorData = {
      success: false,
      message: `Error processing data: ${err.message}`,
    };
    myCache.set("dashboardData", errorData);
  }
}

app.get("/dashboard", async (req, res) => {
  try {
    const cachedData = myCache.get("dashboardData");
    if (cachedData) {
      // Jika data ada di cache, kembalikan data dari cache
      return res.json(cachedData);
    } else {
      // Jika tidak ada di cache, coba jalankan perhitungan sekali lalu kembalikan hasilnya
      await calculateDashboard();
      const freshData = myCache.get("dashboardData");
      if (freshData) {
        return res.json(freshData);
      } else {
        return res.status(500).json({
          success: false,
          message: "Error retrieving data.",
        });
      }
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: `Error: ${err.message}`,
    });
  }
});

//---------START ENDPOINT "LANTAI" (perhitungan done kan?)
async function calculateLantai(lantai) {
  const request = new sql.Request(connectionPool);
  if (!floorTableMap[lantai]) {
    return {
      success: false,
      message: "Lantai tidak ditemukan.",
    };
  }

  const tableName = floorTableMap[lantai];
  const result = await retryOperation(async () =>
    request.query(
      `SELECT no_kWh_Meter, nama_kWh_Meter, ruangan, no_panel
       FROM ${tableName}
       ORDER BY no_panel ASC`
    )
  );

  const meterData = result.recordset;

  if (!meterData.length) {
    return {
      success: false,
      message: "Data tidak ditemukan untuk lantai ini.",
    };
  }

  // Ambil konfigurasi dari tbl_set_value
  const configResult = await retryOperation(async () =>
    request.query(`
      SELECT TOP 1 emission_factor, lbwp, wbp, total_cost_limit, kvarh
      FROM tbl_set_value
      ORDER BY id DESC
    `)
  );

  if (!configResult.recordset.length) {
    return {
      success: false,
      message: "Konfigurasi data tidak ditemukan di database.",
    };
  }

  const { emission_factor, lbwp, wbp, total_cost_limit, kvarh } =
    configResult.recordset[0];

  // Parsing data konfigurasi
  const EMISSION_FACTOR = parseFloat(emission_factor);
  const TARIFFS = {
    LWBP: parseFloat(lbwp),
    WBP: parseFloat(wbp),
    kvarh: parseFloat(kvarh),
  };
  const totalCostLimit = parseFloat(total_cost_limit);

  // Grup data kWh meter berdasarkan ruangan
  const ruanganKwhMeters = meterData.reduce((acc, meter) => {
    const ruangan = meter.ruangan;
    if (!acc[ruangan]) acc[ruangan] = [];
    acc[ruangan].push(meter);
    return acc;
  }, {});

  // Hitung threshold untuk setiap ruangan
  const ruanganThresholds = {};
  Object.keys(ruanganKwhMeters).forEach((ruangan) => {
    const jumlahKwhMeterDiRuangan = ruanganKwhMeters[ruangan].length;
    const totalKwhMeter = 64;
    const thresholdPerMonth =
      (totalCostLimit / (TARIFFS.LWBP * 0.7917 + TARIFFS.WBP * 0.2083)) *
      (jumlahKwhMeterDiRuangan / totalKwhMeter);
    const thresholdPerDay = thresholdPerMonth / 30;
    const thresholdPerYear = thresholdPerMonth * 12;

    const calculateDerivedThresholds = (value) => ({
      energyConsume: value,
      energyConsumeAktual: value * 1.6,
      emission: value * EMISSION_FACTOR,
    });

    ruanganThresholds[ruangan] = {
      perDay: calculateDerivedThresholds(thresholdPerDay),
      perMonth: calculateDerivedThresholds(thresholdPerMonth),
      perYear: calculateDerivedThresholds(thresholdPerYear),
    };
  });

  const getElectricityTariff = (dateTime, pfAvg) => {
    const hour = new Date(dateTime).getHours();
    let tariff = hour >= 23 || hour < 17 ? TARIFFS.LWBP : TARIFFS.WBP;
    if (pfAvg < 0.85) {
      tariff += TARIFFS.kvarh;
    }
    return tariff;
  };
  // Fungsi untuk mendekripsi kolom log
  const decryptLogFields = (row) => {
    const decryptedLog = { ...row };
    [
      "v_avg",
      "I_avg",
      "kVA",
      "kW",
      "kVArh",
      "PF_avg",
      "v_L1",
      "v_L2",
      "v_L3",
    ].forEach((field) => {
      try {
        decryptedLog[field] = parseFloat(
          atuwokzDecode(decodeBase64(decryptAES(row[field])))
        );
      } catch {
        decryptedLog[field] = 0;
      }
    });
    return decryptedLog;
  };

  const logs = {};
  await Promise.all(
    Object.keys(ruanganKwhMeters).map(async (ruangan) => {
      logs[ruangan] = [];
      await Promise.all(
        ruanganKwhMeters[ruangan].map(async (meter) => {
          const sanitizedTableName = `tbl_log_${meter.nama_kWh_Meter.replace(
            /[^a-zA-Z0-9_]/g,
            "_"
          )}`;

          try {
            const logResult = await retryOperation(async () =>
              request.query(`
                SELECT TOP(60) CONVERT(VARCHAR(19), log_waktu, 120) AS log_waktu, v_avg, I_avg, kVA, kW, kVArh, PF_avg, v_L1, v_L2, v_L3
                FROM ${sanitizedTableName}
                WHERE no_kWh_Meter = ${meter.no_kWh_Meter}
                ORDER BY log_waktu DESC
              `)
            );

            logResult.recordset.forEach((log) => {
              const decryptedLog = decryptLogFields(log);
              // Hitung cost di level minute
              const PF_avg = parseFloat(decryptedLog.PF_avg || 0);
              const energyConsume = parseFloat(decryptedLog.kW || 0) / 60; // per minute
              const energyConsumeActual = energyConsume * 1.6;
              const tariff = getElectricityTariff(log.log_waktu, PF_avg);
              const logCost =
                energyConsumeActual * tariff +
                (PF_avg < 0.85 ? energyConsumeActual * TARIFFS.kvarh : 0);

              logs[ruangan].push({
                ...decryptedLog,
                no_kWh_Meter: meter.no_kWh_Meter,
                nama_kWh_Meter: meter.nama_kWh_Meter,
                numericEnergyConsume: energyConsume,
                numericEnergyConsumeActual: energyConsumeActual,
                numericCost: logCost,
              });
            });
          } catch (err) {
            console.error(
              `Failed to fetch logs for table: ${sanitizedTableName}`,
              err.message
            );
          }
        })
      );
    })
  );

  // Fungsi Moving Average
  function predictMonthlyCostWithMovingAverage(
    logGroup,
    year,
    month,
    windowSize = 7
  ) {
    // Kumpulkan biaya harian
    const dailyCosts = {};
    for (const log of logGroup) {
      const date = new Date(log.log_waktu);
      const day = date.getDate();
      if (!dailyCosts[day]) dailyCosts[day] = 0;
      dailyCosts[day] += log.numericCost;
    }

    const daysInMonth = new Date(year, month, 0).getDate();
    const knownDays = Object.keys(dailyCosts)
      .map((d) => parseInt(d, 10))
      .sort((a, b) => a - b);

    if (knownDays.length === 0) {
      // Tidak ada data sama sekali
      return 0;
    }

    // Hitung total biaya yang sudah diketahui
    const totalKnownCost = knownDays.reduce((sum, d) => sum + dailyCosts[d], 0);
    const daysElapsed = knownDays.length;
    const daysRemaining = daysInMonth - daysElapsed;
    if (daysElapsed === 0) {
      return 0;
    }

    // Ambil N hari terakhir
    const recentDays = knownDays.slice(-windowSize);
    const recentCosts = recentDays.map((d) => dailyCosts[d]);
    const movingAverageCost =
      recentCosts.reduce((a, b) => a + b, 0) / recentCosts.length;

    // Prediksi total sebulan = totalKnownCost + (movingAverageCost * daysRemaining)
    const predictedTotal = totalKnownCost + movingAverageCost * daysRemaining;
    return predictedTotal;
  }

  const groupAndAggregateLogs = (logData, granularity) => {
    const formatTimeKey = (log, granularity) => {
      const date = new Date(log.log_waktu);
      const pad = (num) => String(num).padStart(2, "0");
      const formattedTime = `${date.getFullYear()}-${pad(
        date.getMonth() + 1
      )}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
        date.getMinutes()
      )}:${pad(date.getSeconds())}`;

      switch (granularity) {
        case "minute":
          return formattedTime.slice(0, 16);
        case "hour":
          return formattedTime.slice(0, 13);
        case "day":
          return formattedTime.slice(0, 10);
        case "month":
          return formattedTime.slice(0, 7);
        case "year":
          return formattedTime.slice(0, 4);
        default:
          throw new Error("Invalid granularity");
      }
    };

    const groupedLogs = logData.reduce((acc, log) => {
      const key = formatTimeKey(log, granularity);
      acc[key] = acc[key] || [];
      acc[key].push(log);
      return acc;
    }, {});

    return Object.entries(groupedLogs).map(([time, logGroup]) => {
      const totals = logGroup.reduce(
        (sum, log) => {
          sum.kW += parseFloat(log.kW || 0);
          sum.kVA += parseFloat(log.kVA || 0);
          sum.kVArh += parseFloat(log.kVArh || 0);
          sum.v_avg += parseFloat(log.v_avg || 0);
          sum.I_avg += parseFloat(log.I_avg || 0);
          sum.PF_avg += parseFloat(log.PF_avg || 0);
          sum.v_L1 += parseFloat(log.v_L1 || 0);
          sum.v_L2 += parseFloat(log.v_L2 || 0);
          sum.v_L3 += parseFloat(log.v_L3 || 0);
          sum.cost += log.numericCost;
          return sum;
        },
        {
          kW: 0,
          kVA: 0,
          kVArh: 0,
          v_avg: 0,
          I_avg: 0,
          PF_avg: 0,
          v_L1: 0,
          v_L2: 0,
          v_L3: 0,
          cost: 0,
        }
      );

      const count = logGroup.length;
      const energyConsume = totals.kW / 60;
      const energyConsumeActual = energyConsume * 1.6;
      const energyReactive = totals.kVArh / 60;
      const energyApparent = totals.kVA / 60;
      const emission = energyConsumeActual * EMISSION_FACTOR;
      const totalCost = totals.cost;

      let predictedCost = 0;

      if (granularity === "month") {
        const [yearStr, monthStr] = time.split("-");
        const year = parseInt(yearStr, 10);
        const month = parseInt(monthStr, 10);

        // Gunakan moving average untuk prediksi
        predictedCost = predictMonthlyCostWithMovingAverage(
          logGroup,
          year,
          month,
          7
        );
      }

      const result = {
        time,
        V_AVG: totals.v_avg / count,
        I_AVG: totals.I_avg / count,
        PF_AVG: totals.PF_avg / count,
        R_AVG: totals.v_L1 / count,
        S_AVG: totals.v_L2 / count,
        T_AVG: totals.v_L3 / count,
        energyConsume,
        energyConsumeActual,
        energyApparent,
        energyReactive,
        emission,
        cost: new Intl.NumberFormat("id-ID", {
          style: "currency",
          currency: "IDR",
        }).format(totalCost),
      };

      if (granularity === "month") {
        result.predictedCost = new Intl.NumberFormat("id-ID", {
          style: "currency",
          currency: "IDR",
        }).format(predictedCost);
      }

      return result;
    });
  };

  const ruanganData = Object.keys(logs).reduce((acc, ruangan) => {
    const logData = logs[ruangan];

    acc[ruangan] = {
      thresholds: ruanganThresholds[ruangan],
      minuteData: groupAndAggregateLogs(logData, "minute"),
      hourlyData: groupAndAggregateLogs(logData, "hour"),
      dailyData: groupAndAggregateLogs(logData, "day"),
      monthlyData: groupAndAggregateLogs(logData, "month"),
      yearlyData: groupAndAggregateLogs(logData, "year"),
    };

    return acc;
  }, {});

  return {
    success: true,
    data: { Ruangan: ruanganData },
  };
}

async function runFloorCalculations() {
  if (!floorTableMap) return;
  const lantaiKeys = Object.keys(floorTableMap);
  for (const lantaiKey of lantaiKeys) {
    try {
      const data = await calculateLantai(lantaiKey);
      myCache.set(`olahData_${lantaiKey}`, data);
      const timestamp = new Date().toLocaleString("id-ID", {
        timeZone: "Asia/Jakarta",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
      console.log(`[Running Calculate LANTAI --${lantaiKey} -- [${timestamp}]`);
    } catch (err) {
      const timestamp = new Date().toLocaleString("id-ID", {
        timeZone: "Asia/Jakarta",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
      console.error(
        `Error calculating data for ${lantaiKey}:`,
        err,
        ` -- [${timestamp}]`
      );
      // writeLog(`Error calculating data for ${lantaiKey}: ${err.message}`);
      myCache.set(`olahData_${lantaiKey}`, {
        success: false,
        message: `Error processing data: ${err.message}-- [${timestamp}]`,
      });
    }
  }
}

// Endpoint untuk mengambil data olahan per lantai
app.get("/olahData/:lantai", async (req, res) => {
  const { lantai } = req.params;
  try {
    const cachedData = myCache.get(`olahData_${lantai}`);
    if (cachedData) {
      return res.json(cachedData);
    } else {
      const data = await calculateLantai(lantai);
      myCache.set(`olahData_${lantai}`, data);
      return res.json(data);
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: `Error: ${err.message}`,
    });
  }
});

app.get("/debug/cache/:key", (req, res) => {
  const { key } = req.params;
  const cachedData = myCache.get(key);
  res.json(cachedData || { success: false, message: "No data found for key" });
});

app.get("/managementMonitoring", async (req, res) => {
  try {
    const lantaiList = [
      "lantai1",
      "lantai1_annex",
      "lantai2",
      "lantai2_annex",
      "lantai3",
      "lantai3_annex",
      "lantai4",
      "lantai5",
      "lantai6",
      "lantai7",
      "lantai8",
      "lantaiEksternal",
      "lantaiGround",
    ];

    const results = [];
    let totalEmissionOverall = 0;
    let predictedEmissionOverall = 0;

    // Fungsi untuk menghitung prediksi emisi bulanan dari dailyData dengan sisa hari.
    // Contoh: jika hanya ada data tgl 7 dan 8, maka:
    // totalEmissionDaily = emisi dari tgl 7+8
    // avgDailyEmission = totalEmissionDaily / 2
    // sisaHari = daysInMonth - hariTerakhirData (misal 31 - 8 = 23 hari)
    // predictedEmission = totalEmissionDaily + (avgDailyEmission * sisaHari)
    function predictMonthlyEmissionFromDailyData(dailyData) {
      if (!dailyData || dailyData.length === 0) return 0;

      dailyData.sort((a, b) => new Date(a.time) - new Date(b.time));

      const firstDate = new Date(dailyData[0].time);
      const lastDate = new Date(dailyData[dailyData.length - 1].time);
      const year = firstDate.getFullYear();
      const month = firstDate.getMonth() + 1;
      const daysInMonth = new Date(year, month, 0).getDate();

      const totalEmissionDaily = dailyData.reduce(
        (sum, d) => sum + (parseFloat(d.emission) || 0),
        0
      );
      const dataDays = dailyData.length;
      if (dataDays === 0) return 0;

      const avgDailyEmission = totalEmissionDaily / dataDays;
      const lastDayOfData = lastDate.getDate();

      // Hitung sisa hari dalam bulan
      const remainingDays = daysInMonth - lastDayOfData;

      // Prediksi = total emisi yang sudah ada + rata-rata harian * sisa hari
      const predictedEmission =
        totalEmissionDaily + avgDailyEmission * remainingDays;
      return predictedEmission;
    }

    for (const lantai of lantaiList) {
      // writeLog(`Processing ${lantai}...`);
      const cachedData = myCache.get(`olahData_${lantai}`);
      if (!cachedData) {
        // writeLog(`Cache not found for ${lantai}, running calculations.`);
        await runFloorCalculations();
      }

      const updatedCachedData = myCache.get(`olahData_${lantai}`);
      if (!updatedCachedData?.data?.Ruangan) {
        // writeLog(`No data found for ${lantai}, setting values to 0.`);
        results.push({
          lantai,
          energyConsume: 0,
          energyConsumeActual: 0,
          cost: 0,
          emission: 0,
          predictedCost: 0,
        });
        continue;
      }

      let totalEnergyConsume = 0;
      let totalEnergyConsumeActual = 0;
      let totalCostThisMonth = 0;
      let totalEmission = 0; // Emission dari monthlyData (tetap seperti code lama)
      let totalPredictedCost = 0;
      let totalPredictedEmissionForFloor = 0; // predictedEmission dari dailyData

      Object.entries(updatedCachedData.data.Ruangan).forEach(
        ([ruangan, data]) => {
          if (data?.monthlyData?.length > 0) {
            // Sort monthlyData berdasarkan waktu
            data.monthlyData.sort(
              (a, b) => new Date(a.time) - new Date(b.time)
            );

            // Ambil data terbaru (latestData) dari monthlyData untuk emission dan cost
            const latestData = data.monthlyData.reduce((latest, current) => {
              return new Date(current.time) > new Date(latest.time)
                ? current
                : latest;
            });

            if (latestData) {
              const {
                energyConsume,
                energyConsumeActual,
                cost,
                emission,
                predictedCost,
              } = latestData;
              const parsedCost = parseFloat(
                cost.replace(/Rp|\.|,/g, (match) => (match === "," ? "." : ""))
              );
              const parsedPredictedCost = parseFloat(
                predictedCost?.replace(/Rp|\.|,/g, (match) =>
                  match === "," ? "." : ""
                ) || 0
              );

              totalEnergyConsume += parseFloat(energyConsume || 0);
              totalEnergyConsumeActual += parseFloat(energyConsumeActual || 0);
              totalCostThisMonth += parsedCost;
              totalEmission += parseFloat(emission || 0); // Masih dari monthlyData
              totalPredictedCost += parsedPredictedCost;

              // writeLog(
              //   `Lantai: ${lantai}, Ruangan: ${ruangan}, Time: ${latestData.time}, Energy Consume: ${energyConsume}, Energy Consume Actual: ${energyConsumeActual}, Cost: ${cost}, Emission: ${emission}, Predicted Cost: ${predictedCost}, Parsed Cost: ${parsedCost}, Parsed Predicted Cost: ${parsedPredictedCost}, Total Cost So Far: ${totalCostThisMonth}, Total Emission So Far: ${totalEmission}`
              // );
            }
          }

          // Prediksi emisi sekarang ambil dari dailyData dengan menggunakan sisa hari
          if (data?.dailyData?.length > 0) {
            const predictedEmissionForThisRoom =
              predictMonthlyEmissionFromDailyData(data.dailyData);
            totalPredictedEmissionForFloor += predictedEmissionForThisRoom;
            // writeLog(
            //   `Predicted Emission (from dailyData) for lantai: ${lantai}, Ruangan: ${ruangan} = ${predictedEmissionForThisRoom}`
            // );
          } else {
            // Jika tidak ada dailyData, prediksi 0 untuk ruangan ini
            // writeLog(`No dailyData for prediction in lantai: ${lantai}, Ruangan: ${ruangan}`);
          }
        }
      );

      results.push({
        lantai,
        energyConsume: totalEnergyConsume,
        energyConsumeActual: totalEnergyConsumeActual,
        cost: totalCostThisMonth,
        emission: totalEmission,
        predictedCost: totalPredictedCost,
      });

      totalEmissionOverall += totalEmission;
      predictedEmissionOverall += totalPredictedEmissionForFloor; // predicted total dari dailyData

      // writeLog(
      //   `Final Results for ${lantai}: Total Energy Consume: ${totalEnergyConsume}, Total Energy Consume Actual: ${totalEnergyConsumeActual}, Total Cost: ${totalCostThisMonth}, Total Emission: ${totalEmission}, Predicted Emission (Floor): ${totalPredictedEmissionForFloor}, Total Predicted Cost: ${totalPredictedCost}`
      // );
    }

    const sortedByEnergyConsume = [...results].sort(
      (a, b) => b.energyConsume - a.energyConsume
    );
    const sortedByEnergyConsumeActual = [...results].sort(
      (a, b) => b.energyConsumeActual - a.energyConsumeActual
    );
    const sortedByCost = [...results].sort((a, b) => b.cost - a.cost);

    const totalCostOverall = sortedByCost.reduce(
      (sum, item) => sum + item.cost,
      0
    );
    // writeLog(`Total Cost Overall: ${totalCostOverall}`);

    const totalPredictedCostOverall = results.reduce(
      (sum, item) => sum + item.predictedCost,
      0
    );
    // writeLog(`Total Predicted Cost Overall: ${totalPredictedCostOverall}`);

    const formattedTotalCost = new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
    }).format(totalCostOverall);

    const formattedTotalPredictedCost = new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
    }).format(totalPredictedCostOverall);

    const totalCostPerLantai = {};
    sortedByCost.forEach((item) => {
      totalCostPerLantai[item.lantai] = new Intl.NumberFormat("id-ID", {
        style: "currency",
        currency: "IDR",
      }).format(item.cost);
    });

    const totalEnergyConsumeLantai = {};
    const energyConsumeActualLantai = {};
    sortedByEnergyConsume.forEach((item) => {
      totalEnergyConsumeLantai[item.lantai] = item.energyConsume;
    });
    sortedByEnergyConsumeActual.forEach((item) => {
      energyConsumeActualLantai[item.lantai] = item.energyConsumeActual;
    });

    // writeLog(`Final Total Cost Overall: ${formattedTotalCost}`);
    // writeLog(`Final Total Predicted Cost Overall: ${formattedTotalPredictedCost}`);
    // writeLog(`Final Total Emission Overall: ${totalEmissionOverall}`);

    // Perhitungan totalCostLastMonth dan totalCostLastYear
    const currentDate = new Date();
    const currentMonth = currentDate.getMonth() + 1;
    const currentYear = currentDate.getFullYear();

    const lastMonth = currentMonth === 1 ? 12 : currentMonth - 1;
    const lastMonthYear = currentMonth === 1 ? currentYear - 1 : currentYear;
    const lastYear = currentYear - 1;

    let totalCostLastMonth = 0;
    let totalCostLastYear = 0;

    for (const lantai of lantaiList) {
      const cachedData = myCache.get(`olahData_${lantai}`);
      if (cachedData?.data?.Ruangan) {
        Object.entries(cachedData.data.Ruangan).forEach(([ruangan, data]) => {
          // Total cost untuk bulan lalu
          if (data?.monthlyData?.length > 0) {
            data.monthlyData.forEach((entry) => {
              const [entryYear, entryMonthStr] = entry.time.split("-");
              const entryYearNum = parseInt(entryYear);
              const entryMonthNum = parseInt(entryMonthStr);

              if (
                entryYearNum === lastMonthYear &&
                entryMonthNum === lastMonth
              ) {
                const parsedCost = parseFloat(
                  entry.cost.replace(/Rp|\.|,/g, (match) =>
                    match === "," ? "." : ""
                  )
                );
                totalCostLastMonth += parsedCost;
              }
            });
          }

          // Total cost untuk tahun lalu
          if (data?.yearlyData?.length > 0) {
            const yearlyEntry = data.yearlyData.find(
              (ye) => parseInt(ye.time) === lastYear
            );
            if (yearlyEntry) {
              const parsedCost = parseFloat(
                yearlyEntry.cost.replace(/Rp|\.|,/g, (match) =>
                  match === "," ? "." : ""
                )
              );
              totalCostLastYear += parsedCost;
            }
          }
        });
      }
    }
    // writeLog(`Total Cost Last Month: ${totalCostLastMonth}`);
    // writeLog(`Total Cost Last Year: ${totalCostLastYear}`);

    const formattedTotalCostLastMonth = new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
    }).format(totalCostLastMonth);

    const formattedTotalCostLastYear = new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
    }).format(totalCostLastYear);

    const totalSavingCostLastYearValue = totalCostLastYear - totalCostOverall;
    // writeLog(`Raw Total Saving Cost Last Year: ${totalSavingCostLastYearValue}`);

    const formattedTotalSavingCostLastYear = new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
    }).format(totalSavingCostLastYearValue);

    // writeLog(`Total Saving Cost Last Year (Formatted): ${formattedTotalSavingCostLastYear}`);

    const monthMapping = {
      1: "Jan",
      2: "Feb",
      3: "Mar",
      4: "Apr",
      5: "May",
      6: "Jun",
      7: "Jul",
      8: "Aug",
      9: "Sep",
      10: "Oct",
      11: "Nov",
      12: "Dec",
    };

    const totalCostMonthlyChart = {
      Dec: 0,
      Nov: 0,
      Oct: 0,
      Sep: 0,
      Aug: 0,
      Jul: 0,
      Jun: 0,
      May: 0,
      Apr: 0,
      Mar: 0,
      Feb: 0,
      Jan: 0,
    };

    for (const lantai of lantaiList) {
      const cachedData = myCache.get(`olahData_${lantai}`);
      if (cachedData?.data?.Ruangan) {
        Object.entries(cachedData.data.Ruangan).forEach(([ruangan, data]) => {
          if (data?.monthlyData?.length > 0) {
            data.monthlyData.forEach((entry) => {
              const [entryYear, entryMonthStr] = entry.time.split("-");
              const entryMonthNum = parseInt(entryMonthStr, 10);
              const monthName = monthMapping[entryMonthNum];
              if (monthName) {
                const parsedCost = parseFloat(
                  entry.cost.replace(/Rp|\.|,/g, (match) =>
                    match === "," ? "." : ""
                  )
                );
                if (!isNaN(parsedCost)) {
                  totalCostMonthlyChart[monthName] += parsedCost;
                }
              }
            });
          }
        });
      }
    }

    Object.keys(totalCostMonthlyChart).forEach((month) => {
      if (totalCostMonthlyChart[month] === 0) {
        totalCostMonthlyChart[month] = null;
      } else {
        totalCostMonthlyChart[month] = new Intl.NumberFormat("id-ID", {
          style: "currency",
          currency: "IDR",
        }).format(totalCostMonthlyChart[month]);
      }
    });

    // Gunakan predictedEmissionOverall yang didapat dari dailyData untuk predictedEmission
    return res.status(200).json({
      success: true,
      data: {
        totalEnergyConsumeLantai,
        energyConsumeActualLantai,
        totalCostMonthlyChart,
        totalCostPerLantai,
        totalCostThisMonth: formattedTotalCost,
        emission: totalEmissionOverall, // dari monthlyData seperti semula
        predictedEmission: predictedEmissionOverall, // prediksi menggunakan sisa hari di bulan
        predictedCost: formattedTotalPredictedCost,
        totalCostLastMonth: formattedTotalCostLastMonth,
        totalCostLastYear: formattedTotalCostLastYear,
        totalSavingCostLastYear: formattedTotalSavingCostLastYear,
      },
    });
  } catch (error) {
    // writeLog(`Error in /managementMonitoring: ${error.message}`);
    console.error("Error in /managementMonitoring:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// ================ endpoint Calculating SOLAR PV

app.get("/solarPV", async (req, res) => {
  //calculateSolarPV();

  try {
    const cachedData = myCache.get("solarPVdata");
    if (cachedData) {
      // Jika data ada di cache, kembalikan data dari cache
      return res.json(cachedData);
    } else {
      // Jika tidak ada di cache, coba jalankan perhitungan sekali lalu kembalikan hasilnya
      await calculateSolarPV();
      const freshData = myCache.get("solarPVdata");
      if (freshData) {
        return res.json(freshData);
      } else {
        return res.status(500).json({
          success: false,
          message: "Error retrieving data.",
        });
      }
    }
  } catch (e) {
    console.error("Error in /solarPV:", e);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

async function calculateSolarPV() {
  try {
    const timestamp = new Date().toLocaleString("id-ID", {
      timeZone: "Asia/Jakarta",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });

    console.log(`[Running Calculate Solar PV -- [${timestamp}]]`);

    const tableName = "tbl_log_kWh_PLTS";
    const logs = [];

    await retryOperation(
      () =>
        new Promise((resolve, reject) => {
          const request = new sql.Request(connectionPool);
          request.stream = true;

          // console.log(`Executing query on table: ${tableName}`);
          // Query SQL untuk mengambil data
          request.query(`
          SELECT TOP(60) CONVERT(VARCHAR(19), log_waktu, 120) AS log_waktu, kW, no_kWh_Meter
          FROM ${tableName}
          ORDER BY log_waktu DESC
        `);

          // Event handler ketika menerima baris data
          request.on("row", (row) => {
            const decryptedRow = { ...row };

            // Proses dekripsi data pada kolom tertentu
            ["kW"].forEach((field) => {
              try {
                decryptedRow[field] = parseFloat(
                  atuwokzDecode(decodeBase64(decryptAES(row[field])))
                );
              } catch (error) {
                decryptedRow[field] = 0; // Default jika terjadi kesalahan
              }
            });

            // Hitung pvProduce dalam kWh
            const pvProducekwh = parseFloat(decryptedRow.kW || 0) / 60;
            decryptedRow.pvProducekwh = pvProducekwh;

            // Tambahkan baris yang telah diproses ke dalam logs
            logs.push(decryptedRow);
          });

          // Event handler ketika terjadi kesalahan
          request.on("error", (err) => {
            console.error(`Error in SQL request: ${err.message}`);
            console.error("Stack trace:", err.stack);
            reject(err);
          });

          // Event handler ketika selesai memproses semua baris
          request.on("done", () => {
            resolve();
          });
        })
    );

    const groupAndAggregateLogs = (granularity) => {
      const formatTimeKey = (log, granularity) => {
        const date = new Date(log.log_waktu);
        const pad = (num) => String(num).padStart(2, "0");
        const formattedTime = `${date.getFullYear()}-${pad(
          date.getMonth() + 1
        )}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
          date.getMinutes()
        )}:${pad(date.getSeconds())}`;

        switch (granularity) {
          case "minute":
            return formattedTime.slice(0, 16);
          case "hour":
            return formattedTime.slice(0, 13);
          case "day":
            return formattedTime.slice(0, 10);
          case "month":
            return formattedTime.slice(0, 7);
          case "year":
            return formattedTime.slice(0, 4);
          default:
            throw new Error("Invalid granularity");
        }
      };

      const groupedLogs = logs.reduce((acc, log) => {
        const key = formatTimeKey(log, granularity);
        acc[key] = acc[key] || [];
        acc[key].push(log);

        return acc;
      }, {});

      return Object.entries(groupedLogs).map(([time, logGroup]) => {
        const totals = logGroup.reduce(
          (sum, log) => {
            sum.pvProducekwh += log.pvProducekwh;
            return sum;
          },
          { pvProducekwh: 0 }
        );

        const count = logGroup.length;
        const PVprodkwh = totals.pvProducekwh;

        return {
          time,
          PVprodkwh,
        };
      });
    };

    const minuteData = groupAndAggregateLogs("minute");
    //  const hourlyData = groupAndAggregateLogs("hour");
    const dailyData = groupAndAggregateLogs("day");
    const monthlyData = groupAndAggregateLogs("month");
    const yearlyData = groupAndAggregateLogs("year");
    const AC_AREA = 13199.79;

    // const calculateEEI = (data) =>
    //   data.map((entry) => ({
    //     ...entry,
    //     EEI: entry.PVprodkwh,
    //   }));

    // console.log(minuteData);

    const SOLAR_PV = {
      success: true,
      data: {
        minuteData: minuteData,
        // hourlyData: hourlyData,
        dailyData: dailyData,
        monthlyData: monthlyData,
        yearlyData: yearlyData,
      },
    };
    myCache.set("solarPVdata", SOLAR_PV);
  } catch (err) {
    console.error(err);
    const errorData = {
      success: false,
      message: `Error processing data: ${err.message}`,
    };
    myCache.set("solarPVdata", errorData);
  }
}

// ================ END

// ============================= Run Dashboard Operator

app.get("/DashboardOperator", async (req, res) => {
  try {
    const cachedData = myCache.get("DashboardOperator");
    if (cachedData) {
      // Jika data ada di cache, kembalikan data dari cache
      return res.json(cachedData);
    } else {
      // Jika tidak ada di cache, coba jalankan perhitungan sekali lalu kembalikan hasilnya
      await runDasboradOperator();
      const freshData = myCache.get("DashboardOperator");
      if (freshData) {
        return res.json(freshData);
      } else {
        return res.status(500).json({
          success: false,
          message: "Error retrieving data.",
        });
      }
    }
  } catch (e) {
    console.error("Error in /DashboardOperator:", e);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

async function runDasboradOperator() {
  try {
    let responseDataPerPM = [];

    if (!sanitizedTableNamesCache) await initializeTableCache();
    const timestamp = new Date().toLocaleString("id-ID", {
      timeZone: "Asia/Jakarta",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });

    console.log(`[Running Calculate DashboardOperator -- [${timestamp}]`);
    const logs = [];

    await Promise.all(
      sanitizedTableNamesCache.map((tableName) =>
        retryOperation(
          () =>
            new Promise((resolve, reject) => {
              const request = new sql.Request(connectionPool);

              request.stream = true;
              request.query(
                `SELECT TOP(60) CONVERT(VARCHAR(19), log_waktu, 120) AS log_waktu, v_avg, I_avg, kVA, kW, kVArh, PF_avg, no_kWh_Meter
              FROM ${tableName}
              ORDER BY log_waktu DESC`
              );

              request.on("row", (row) => {
                const decryptedRow = { ...row };
                ["kVA", "kW", "kVArh", "PF_avg", "v_avg", "I_avg"].forEach(
                  (field) => {
                    try {
                      decryptedRow[field] = parseFloat(
                        atuwokzDecode(decodeBase64(decryptAES(row[field])))
                      );
                    } catch {
                      decryptedRow[field] = 0;
                    }
                  }
                );

                // ADD: Hitung cost di level log
                const energyConsume = parseFloat(decryptedRow.kW || 0) / 60;
                const energyConsumeActual = energyConsume * 1.6;

                decryptedRow.energyConsume = energyConsume;
                decryptedRow.energyConsumeActual = energyConsumeActual;
                logs.push(decryptedRow);
              });
              request.on("error", (err) => reject(err));
              request.on("done", () => resolve());
            })
        )
      )
    );

    // ============================= Count per Lantai
    const groupedDataNokwh = logs.reduce((acc, log) => {
      const meter = log.no_kWh_Meter;

      // Inisialisasi array untuk no_kWh_Meter jika belum ada
      if (!acc[meter]) {
        acc[meter] = [];
      }
      acc[meter] = meter;

      return acc;
    }, {});

    const floorGroups = {
      lantai1: ["1", "2", "3", "4", "5", "6", "7", "8", "9"],
      lantai1_annex: ["10", "11", "12", "13"],
      lantai2: ["15", "16", "17", "18", "19", "20"],
      lantai2_annex: ["21", "22"],
      lantai3: ["23", "24", "25", "26"],
      lantai3_annex: ["27", "28", "29", "30"],
      lantai4: ["31", "32", "33", "34"],
      lantai5: ["35", "36", "37", "38", "39"],
      lantai6: ["40", "41", "42", "43"],
      lantai7: ["44", "45", "46", "47"],
      lantai8: [
        "48",
        "49",
        "50",
        "51",
        "52",
        "53",
        "54",
        "55",
        "56",
        "57",
        "58",
        "59",
      ],
      lantaiEksternal: ["60", "61", "62", "63", "64"],
      lantaiGround: ["14"],
    };

    const groupByFloorMeterDateAndTime = (logs) => {
      // Inisialisasi struktur untuk lantai
      const groupedByFloor = Object.keys(floorGroups).reduce((acc, floor) => {
        acc[floor] = {};
        return acc;
      }, {});

      // Iterasi melalui setiap log
      logs.forEach((log) => {
        const meter = log.no_kWh_Meter;
        const floor = Object.keys(floorGroups).find((floor) =>
          floorGroups[floor].map(String).includes(String(meter).trim())
        );

        // Abaikan log jika no_kWh_Meter tidak ditemukan di floorGroups
        if (!floor) return;

        // Inisialisasi struktur untuk no_kWh_Meter jika belum ada
        if (!groupedByFloor[floor][meter]) {
          groupedByFloor[floor][meter] = { kWhMenit: {}, kWhHari: {} };
        }

        // Format waktu ke tingkat jam
        const logTime = log.log_waktu.slice(0, 13); // Ambil hingga "YYYY-MM-DD HH"
        const logDate = log.log_waktu.slice(0, 10); // Ambil hingga "YYYY-MM-DD"

        // Tambahkan konsumsi energi ke waktu yang sesuai
        if (!groupedByFloor[floor][meter].kWhMenit[logTime]) {
          groupedByFloor[floor][meter].kWhMenit[logTime] = 0;
        }
        groupedByFloor[floor][meter].kWhMenit[logTime] +=
          parseFloat(log.kW || 0) / 60; //kwh diambil perjam -> data permenit maka di bagi 60

        // Tambahkan konsumsi energi ke tanggal yang sesuai
        if (!groupedByFloor[floor][meter].kWhHari[logDate]) {
          groupedByFloor[floor][meter].kWhHari[logDate] = 0;
        }
        groupedByFloor[floor][meter].kWhHari[logDate] +=
          parseFloat(log.kW || 0) / 60;
      });

      return groupedByFloor;
    };

    const result = groupByFloorMeterDateAndTime(logs);
    //console.log("Grouped Data:", JSON.stringify(result, null, 2));

    // ============================= END

    const groupAndAggregateLogs = (granularity) => {
      const formatTimeKey = (log, granularity) => {
        const date = new Date(log.log_waktu);
        const pad = (num) => String(num).padStart(2, "0");
        const formattedTime = `${date.getFullYear()}-${pad(
          date.getMonth() + 1
        )}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
          date.getMinutes()
        )}:${pad(date.getSeconds())}`;

        switch (granularity) {
          case "minute":
            return formattedTime.slice(0, 16);
          case "hour":
            return formattedTime.slice(0, 13);
          case "day":
            return formattedTime.slice(0, 10);
          case "month":
            return formattedTime.slice(0, 7);
          case "year":
            return formattedTime.slice(0, 4);
          default:
            throw new Error("Invalid granularity");
        }
      };

      const groupedLogs = logs.reduce((acc, log) => {
        const key = formatTimeKey(log, granularity);
        acc[key] = acc[key] || [];
        acc[key].push(log);
        return acc;
      }, {});

      return Object.entries(groupedLogs).map(([time, logGroup]) => {
        const totals = logGroup.reduce(
          (sum, log) => {
            sum.kW += log.kW;
            sum.kVA += log.kVA;
            sum.kVArh += log.kVArh;
            sum.v_avg += log.v_avg;
            sum.I_avg += log.I_avg;
            sum.energyConsume += log.energyConsume;
            sum.energyConsumeActual += log.energyConsumeActual;
            return sum;
          },
          {
            kW: 0,
            kVA: 0,
            kVArh: 0,
            v_avg: 0,
            I_avg: 0,
            PF_avg: 0,
            cost: 0,
            energyConsume: 0,
            energyConsumeActual: 0,
          }
        );

        const count = logGroup.length;
        const energyConsume = totals.energyConsume;
        const energyConsumeActual = totals.energyConsumeActual;
        const energyReactive = totals.kVArh / 60;
        const energyApparent = totals.kVA / 60;

        return {
          time,
          V_AVG: totals.v_avg / count,
          I_AVG: totals.I_avg / count,
          PF_AVG: totals.PF_avg / count,
          energyConsume,
          energyConsumeActual,
          energyApparent,
          energyReactive,
        };
      });
    };

    const minuteData = groupAndAggregateLogs("minute");
    const hourlyData = groupAndAggregateLogs("hour");
    const dailyData = groupAndAggregateLogs("day");
    const monthlyData = groupAndAggregateLogs("month");
    const yearlyData = groupAndAggregateLogs("year");
    const AC_AREA = 13199.79;

    const calculateEEI = (data) =>
      data.map((entry) => ({
        ...entry,
        EEI: entry.energyConsumeActual / AC_AREA,
      }));

    const dashboardOperatorData = {
      success: true,
      data: {
        minuteData: calculateEEI(minuteData),
        hourlyData: calculateEEI(hourlyData),
        dailyData: calculateEEI(dailyData),
        monthlyData: calculateEEI(monthlyData),
        yearlyData: calculateEEI(yearlyData),
        dataOperator: result,
      },
    };

    myCache.set("DashboardOperator", dashboardOperatorData);
  } catch (err) {
    console.error(err);
    throw new Error(
      `Terjadi kesalahan saat memproses DashboardOperator: ${err.message}`
    );
  }
}

// ============================ End

// ======================================= Start Caching
let ClientCache;

async function initializeCache() {
  try {
    ClientCache = ChaceTempSAve.createClient({
      url: process.env.CACHE_URL,
    });

    // Event handlers
    ClientCache.on("error", (err) => console.error("Cache Error:", err));
    ClientCache.on("connect", () => console.log("Cache Connected"));

    // Koneksi ke Redis
    await ClientCache.connect();
    console.log("Cache initialized");
  } catch (err) {
    console.error("Error during initialization:", err);
  }
}

// Simpan data ke Cache
async function setCache(key, value) {
  try {
    await ClientCache.set(key, JSON.stringify(value));
    console.log(`Data saved to Redis with key: ${key}`);
  } catch (err) {
    console.error(`Error saving data to Redis with key: ${key}`, err);
  }
}

// Ambil dari cache
async function getCache(key) {
  try {
    const cachedData = await ClientCache.get(key);
    if (cachedData) {
      console.log(`Cache hit for key: ${key}`);
      return JSON.parse(cachedData);
    } else {
      console.log(`Cache miss for key: ${key}`);
      return null;
    }
  } catch (err) {
    console.error(`Error retrieving data from Redis with key: ${key}`, err);
    return null;
  }
}

// Check Validasi

async function validateCache(key, validatorFn) {
  try {
    const cachedData = await getCache(key);
    if (cachedData && validatorFn(cachedData)) {
      console.log(`Cache validation passed for key: ${key}`);
      return cachedData;
    } else {
      console.log(`Cache validation failed for key: ${key}`);
      return null;
    }
  } catch (err) {
    console.error(`Error validating cache for key: ${key}`, err);
    return null;
  }
}

// Hapus Cache

async function deleteCache(key) {
  try {
    const result = await ClientCache.del(key);
    if (result) {
      console.log(`Cache deleted for key: ${key}`);
    } else {
      console.log(`No cache found to delete for key: ${key}`);
    }
  } catch (err) {
    console.error(`Error deleting cache for key: ${key}`, err);
  }
}

// Close Cache

async function closeCache() {
  try {
    await ClientCache.quit();
    console.log("Cache disconnected");
  } catch (err) {
    console.error("Error closing Cache connection:", err);
  }
}

// ========================= Run Setup Calculation Hour
(async () => {
  await initializeCache();
})();

app.get("/CalculationHour", async (req, res) => {
  //SetupDataperJam();

  try {
    // Memanggil fungsi setupDataJam secara asynchronous dan menunggu hasilnya

    const checkDataCache = await getCache("/calculationHour");

    if (checkDataCache) {
      //ada cache
      console.log(`Cache data EXIST`);
      const dataCacheExist = await getCache("/calculationHour");

      return res.json(dataCacheExist);
    } else {
      return res.status(500).json({
        success: false,
        message: "Error retrieving data. Cache",
      });
    }
  } catch (e) {
    // Tangani jika ada error di dalam proses
    console.error("Error in /CalculationHour:", e);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

app.get("/CalculationDaily", async (req, res) => {
  // const aaa = await finalAllDataDaily();
  // return res.json(aaa);

  try {
    // Memanggil fungsi setupDataJam secara asynchronous dan menunggu hasilnya

    const checkDataCache = await getCache("/calculationDaily");

    if (checkDataCache) {
      //ada cache
      console.log(`Cache data EXIST`);
      const dataCacheExist = await getCache("/calculationDaily");

      return res.json(dataCacheExist);
    } else {
      return res.status(500).json({
        success: false,
        message: "Error retrieving data. Cache",
      });
    }
  } catch (e) {
    // Tangani jika ada error di dalam proses
    console.error("Error in /calculationDaily:", e);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

app.get("/CalculationMonthly", async (req, res) => {
  // const aaa = await finalAllDataDaily();
  // return res.json(aaa);

  try {
    // Memanggil fungsi setupDataJam secara asynchronous dan menunggu hasilnya

    const checkDataCache = await getCache("/calculationMonthly");

    if (checkDataCache) {
      //ada cache
      console.log(`Cache data EXIST`);
      const dataCacheExist = await getCache("/calculationMonthly");

      return res.json(dataCacheExist);
    } else {
      return res.status(500).json({
        success: false,
        message: "Error retrieving data. Cache",
      });
    }
  } catch (e) {
    // Tangani jika ada error di dalam proses
    console.error("Error in /calculationMonthly:", e);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

app.get("/CalculationYearly", async (req, res) => {
  // const aaa = await finalAllDataDaily();
  // return res.json(aaa);

  try {
    // Memanggil fungsi setupDataJam secara asynchronous dan menunggu hasilnya

    const checkDataCache = await getCache("/calculationYearly");

    if (checkDataCache) {
      //ada cache
      console.log(`Cache data EXIST`);
      const dataCacheExist = await getCache("/calculationYearly");

      return res.json(dataCacheExist);
    } else {
      return res.status(500).json({
        success: false,
        message: "Error retrieving data. Cache",
      });
    }
  } catch (e) {
    // Tangani jika ada error di dalam proses
    console.error("Error in /calculationYearly:", e);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

app.get("/DashboardManage", async (req, res) => {
  // const aaa = await finalAllDataDaily();
  // return res.json(aaa);

  try {
    // Memanggil fungsi setupDataJam secara asynchronous dan menunggu hasilnya
    // const dataDash = await DashboardManagement();

    // return res.json(dataDash);
    const checkDataCache = await getCache("/manageDasboard");
    
    if (checkDataCache) {
      //ada cache
      console.log(`Cache data EXIST`);
      const dataCacheExist = await getCache("/manageDasboard");

      return res.json(dataCacheExist);
    } else {
      return res.status(500).json({
        success: false,
        message: "Error retrieving data. Cache",
      });
    }
  } catch (e) {
    // Tangani jika ada error di dalam proses
    console.error("Error in /calculationYearly:", e);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// =================================================== End

const logs = [];

const tariffPerKWhLWBP = 1035.28;
const tariffPerKWhWBP = 1553.67;
const tariffKVARH = 1000; // ENKO SEK
const tariffPLNTotal = 0;

const tarifPVincome = 1035.78;
const tarifRECExpense = 35000.0;
const AC_AREA = 13199.79;

const finalDataToSend = {
  HourData: {}, // Membuat objek HourData kosong
};
const finalDataToSendDaily = {
  DailyData: {},
};
const finalDataToSendMonthly = {
  MonthlyData: {},
};
const finalDataToSendYearly = {
  YearlyData: {},
};

const finalDataToSolarPV = {
  HourData: {},
};
const finalDataToSolarPVDaily = {
  DailyData: {},
};
const finalDataToSolarPVMonthly = {
  MonthlyData: {},
};
const finalDataToSolarPVYearly = {
  YearlyData: {},
};

const finalManDataDaily = {
  DailyData: {},
};
const finalManDataMonthly = {
  MonthlyData: {},
};
const finalManDataYearly = {
  YearlyData: {},
};
// ============================== Create data untuk perhitungan PLTSperJam

const queryPLTSperJam = () => {
  return new Promise((resolve, reject) => {
    try {
      const afterDekrip = {};

      const openConn = new sql.Request(connectionPool);
      openConn.stream = true;

      const queSolarPV = `
      SELECT TOP(60) 
             CONVERT(VARCHAR(19), log_waktu, 120) AS log_waktu, 
             v_avg, I_avg, kVA, kW, kVArh, PF_avg, no_kWh_Meter, nama_kWh_Meter,freq,
             v_L1,v_L2,v_L3,v_12,v_23,v_31,I_A1,I_A2,I_A3
           FROM [tbl_log_kWh_PLTS]
           WHERE log_waktu >= DATEADD(HOUR, -1, GETDATE())
             AND log_waktu <= GETDATE() 
           ORDER BY log_waktu DESC     
      `;

      openConn.query(queSolarPV);

      openConn.on("row", (rest) => {
        const dekripData = { ...rest };

        [
          "kVA",
          "kW",
          "kVArh",
          "PF_avg",
          "v_avg",
          "I_avg",
          "freq",
          "v_L1",
          "v_L2",
          "v_L3",
          "v_12",
          "v_23",
          "v_31",
          "I_A1",
          "I_A2",
          "I_A3",
        ].forEach((indexField) => {
          try {
            dekripData[indexField] = parseFloat(
              atuwokzDecode(decodeBase64(decryptAES(rest[indexField])))
            );
          } catch {
            dekripData[indexField] = 0; // Jika dekripsi gagal, set nilai ke 0
          }
        });

        // destructuring dekrip Data new
        // const {
        //   nama_kWh_Meter,
        //   no_kWh_Meter,
        //   log_waktu,
        //   kW,
        //   kVArh,
        //   v_avg,
        //   I_avg,
        //   PF_avg,
        //   freq,
        //   v_L1,
        //   v_L2,
        //   v_L3,
        //   v_12,
        //   v_23,
        //   v_31,
        //   I_A1,
        //   I_A2,
        //   I_A3,
        // } = dekripData;

        // destructuring OLD way
        const namaKWHMeter = rest.nama_kWh_Meter;
        const nokWhMeter = rest.no_kWh_Meter;
        const logWaktu = rest.log_waktu;
        const kwVal = dekripData.kW;
        const kvaArhVal = dekripData.kVArh;
        const vAvgVal = dekripData.v_avg;
        const IAvgVal = dekripData.I_avg;
        const pfAvgVal = dekripData.PF_avg;
        const freqVal = dekripData.freq;
        const vL1Val = dekripData.v_L1;
        const vL2Val = dekripData.v_L2;
        const vL3Val = dekripData.v_L3;
        const v12Val = dekripData.v_12;
        const v23Val = dekripData.v_23;
        const v31Val = dekripData.v_31;
        const iA1Val = dekripData.I_A1;
        const iA2Val = dekripData.I_A2;
        const iA3Val = dekripData.I_A3;

        //            console.log(`HAHAH`,dekripData.nama_kWh_Meter);

        // Start & add data jika tidak ada maka default value 0
        if (!afterDekrip[rest.nama_kWh_Meter]) {
          afterDekrip[rest.nama_kWh_Meter] = {
            nama_kWh_Meter: namaKWHMeter,
            no_kWh_Meter: nokWhMeter,
            log_waktu: logWaktu, // Ambil log_waktu dari data pertama
            total_kW: 0,
            total_kVArh: 0,
            total_kWh: 0,
            total_kVArhTotal: 0,
            avg_v_avg: 0,
            avg_I_avg: 0,
            avg_PF_avg: 0,
            count: 0,
            totalCost: 0,
            avg_freq: 0,
            avg_v_L1: 0,
            avg_v_L2: 0,
            avg_v_L3: 0,
            avg_v_12: 0,
            avg_v_23: 0,
            avg_v_31: 0,
            avg_I_A1: 0,
            avg_I_A2: 0,
            avg_I_A3: 0,
          };
        }

        //rekonstruksi Data yang telah di enkripsi untuk di buat objectnya dan menghitung Total beserta rerata
        const dataSolarPV = afterDekrip[rest.nama_kWh_Meter];

        //console.log(`HAHAH`,dataSolarPV);

        dataSolarPV.total_kW += kwVal || 0;
        dataSolarPV.total_kVArh += kvaArhVal || 0;
        dataSolarPV.total_kWh += dataSolarPV.total_kW || 0; // Asumsi total kWh dihitung berdasarkan total kW
        dataSolarPV.total_kVArhTotal += dataSolarPV.total_kVArh || 0; // Update total kVArh

        dataSolarPV.avg_v_avg += vAvgVal || 0;
        dataSolarPV.avg_I_avg += IAvgVal || 0;
        dataSolarPV.avg_PF_avg += pfAvgVal || 0;

        dataSolarPV.avg_freq += freqVal || 0;
        dataSolarPV.avg_v_L1 += vL1Val || 0;
        dataSolarPV.avg_v_L2 += vL2Val || 0;
        dataSolarPV.avg_v_L3 += vL3Val || 0;
        dataSolarPV.avg_v_12 += v12Val || 0;
        dataSolarPV.avg_v_23 += v23Val || 0;
        dataSolarPV.avg_v_31 += v31Val || 0;
        dataSolarPV.avg_I_A1 += iA1Val || 0;
        dataSolarPV.avg_I_A2 += iA2Val || 0;
        dataSolarPV.avg_I_A3 += iA3Val || 0;

        dataSolarPV.count += 1; //hitung total data yang masuk untuk pembagian rata-rata

        // if(dataSolarPV.count === 60){
        //  resolve(dataSolarPV); //return data PLTS final
        // }
        //finalDataToSolarPV.HourData = dataSolarPV;
        // const csv = parse(dataSolarPV);
        // fsCSV.writeFileSync('dataSolarPV.csv', csv);
        // console.log(dataSolarPV);
      });

      openConn.on("done", () => {
        if (Object.keys(afterDekrip).length === 0) {
          throw new Error("No data Hour SolarPV Recorded");
        } else {
          Object.values(afterDekrip).forEach((LastdataSolarPV) => {
            //console.log(`HAHAH`,LastdataSolarPV);
            LastdataSolarPV.avg_v_avg = parseFloat(
              (
                LastdataSolarPV.avg_v_avg / (LastdataSolarPV.count || 1)
              ).toFixed(2)
            );
            LastdataSolarPV.avg_I_avg = parseFloat(
              (
                LastdataSolarPV.avg_I_avg / (LastdataSolarPV.count || 1)
              ).toFixed(2)
            );
            LastdataSolarPV.avg_PF_avg = parseFloat(
              (
                LastdataSolarPV.avg_PF_avg / (LastdataSolarPV.count || 1)
              ).toFixed(2)
            );

            LastdataSolarPV.avg_freq = parseFloat(
              (LastdataSolarPV.avg_freq / (LastdataSolarPV.count || 1)).toFixed(
                2
              )
            );
            LastdataSolarPV.avg_v_L1 = parseFloat(
              (LastdataSolarPV.avg_v_L1 / (LastdataSolarPV.count || 1)).toFixed(
                2
              )
            );
            LastdataSolarPV.avg_v_L2 = parseFloat(
              (LastdataSolarPV.avg_v_L2 / (LastdataSolarPV.count || 1)).toFixed(
                2
              )
            );

            LastdataSolarPV.avg_v_L3 = parseFloat(
              (LastdataSolarPV.avg_v_L3 / (LastdataSolarPV.count || 1)).toFixed(
                2
              )
            );
            LastdataSolarPV.avg_v_12 = parseFloat(
              (LastdataSolarPV.avg_v_12 / (LastdataSolarPV.count || 1)).toFixed(
                2
              )
            );
            LastdataSolarPV.avg_v_23 = parseFloat(
              (LastdataSolarPV.avg_v_23 / (LastdataSolarPV.count || 1)).toFixed(
                2
              )
            );

            LastdataSolarPV.avg_v_31 = parseFloat(
              (LastdataSolarPV.avg_v_31 / (LastdataSolarPV.count || 1)).toFixed(
                2
              )
            );
            LastdataSolarPV.avg_I_A1 = parseFloat(
              (LastdataSolarPV.avg_I_A1 / (LastdataSolarPV.count || 1)).toFixed(
                2
              )
            );
            LastdataSolarPV.avg_I_A2 = parseFloat(
              (LastdataSolarPV.avg_I_A2 / (LastdataSolarPV.count || 1)).toFixed(
                2
              )
            );
            LastdataSolarPV.avg_I_A3 = parseFloat(
              (LastdataSolarPV.avg_I_A3 / (LastdataSolarPV.count || 1)).toFixed(
                2
              )
            );

            // Format total kWh dan total kVArh agar memiliki 2 angka desimal
            LastdataSolarPV.total_kWh = parseFloat(
              LastdataSolarPV.total_kWh.toFixed(2)
            );
            LastdataSolarPV.total_kVArhTotal = parseFloat(
              LastdataSolarPV.total_kVArhTotal.toFixed(2)
            );

            // Menghitung biaya total (total kWh * tarif dasar)
            LastdataSolarPV.totalCost = parseFloat(
              (LastdataSolarPV.total_kWh * tarifPVincome).toFixed(2)
            );

            delete LastdataSolarPV.count;
          });
        }

        Object.keys(afterDekrip).forEach((key) => {
          const keySolarPVdata = afterDekrip[key];
          const { nama_kWh_Meter, ...restData } = keySolarPVdata;

          // Menambahkan data ke HourData dengan nama_kWh_Meter sebagai kunci
          finalDataToSolarPV.HourData[nama_kWh_Meter] = restData;
          //console.log(finalDataToSolarPV);
          resolve(finalDataToSolarPV);
        });
      });
    } catch (err) {
      reject(err);
    }
  });
};

// ========================================== END

// =========================== Create Data ALL PANEL KECUALI PLTS

const queryPanelperJam = async () => {
  //const finalDataToSend = { HourData: {} }; // Inisialisasi finalDataToSend

  const TarifListrik = (dateTime, pfAvg) => {
    const hour = new Date(dateTime).getHours();
    // console.log(hour);

    let tariff = hour >= 23 || hour < 17 ? tariffPerKWhLWBP : tariffPerKWhWBP;
    if (pfAvg < 0.85) {
      tariff += tariffKVARH;
    }
    return tariff;
  };

  try {
    // Mulai pemrosesan dengan map sanitasi tabel
    await Promise.all(
      sanitizedTableNamesCache.map((tableName) =>
        retryOperation(
          () =>
            new Promise((resolve, reject) => {
              const request = new sql.Request(connectionPool);
              const result = {}; // Menyimpan hasil berdasarkan nama_kWh_Meter

              request.stream = true;

              // Query untuk mendapatkan data dari satu jam terakhir
              request.query(
                `SELECT TOP(60) 
                    CONVERT(VARCHAR(19), log_waktu, 120) AS log_waktu, 
                    v_avg, I_avg, kVA, kW, kVArh, PF_avg, no_kWh_Meter, nama_kWh_Meter, freq,
                    v_L1, v_L2, v_L3, v_12, v_23, v_31, I_A1, I_A2, I_A3
                   FROM ${tableName}
                   WHERE log_waktu >= DATEADD(HOUR, -1, GETDATE())
                     AND log_waktu <= GETDATE() 
                   ORDER BY log_waktu DESC`
              );

              // Proses data saat row datang
              request.on("row", (row) => {
                const decryptedRow = { ...row };

                // Dekripsi dan parse field numerik
                [
                  "kVA",
                  "kW",
                  "kVArh",
                  "PF_avg",
                  "v_avg",
                  "I_avg",
                  "freq",
                  "v_L1",
                  "v_L2",
                  "v_L3",
                  "v_12",
                  "v_23",
                  "v_31",
                  "I_A1",
                  "I_A2",
                  "I_A3",
                ].forEach((field) => {
                  try {
                    decryptedRow[field] = parseFloat(
                      atuwokzDecode(decodeBase64(decryptAES(row[field])))
                    );
                  } catch {
                    decryptedRow[field] = 0; // Jika dekripsi gagal, set ke 0
                  }
                });

                // Extract field yang diperlukan
                const {
                  nama_kWh_Meter,
                  no_kWh_Meter,
                  log_waktu,
                  kW,
                  kVArh,
                  v_avg,
                  I_avg,
                  PF_avg,
                  freq,
                  v_L1,
                  v_L2,
                  v_L3,
                  v_12,
                  v_23,
                  v_31,
                  I_A1,
                  I_A2,
                  I_A3,
                } = decryptedRow;

                // Inisialisasi data meter jika belum ada
                if (!result[nama_kWh_Meter]) {
                  result[nama_kWh_Meter] = {
                    nama_kWh_Meter,
                    no_kWh_Meter,
                    log_waktu,
                    total_kW: 0,
                    total_kVArh: 0,
                    total_kWh: 0,
                    total_kVArhTotal: 0,
                    avg_v_avg: 0,
                    avg_I_avg: 0,
                    avg_PF_avg: 0,
                    count: 0,
                    totalCost: 0,
                    avg_freq: 0,
                    avg_v_L1: 0,
                    avg_v_L2: 0,
                    avg_v_L3: 0,
                    avg_v_12: 0,
                    avg_v_23: 0,
                    avg_v_31: 0,
                    avg_I_A1: 0,
                    avg_I_A2: 0,
                    avg_I_A3: 0,
                  };
                }

                // Update data meter
                const meterData = result[nama_kWh_Meter];
                meterData.total_kW += kW || 0;
                meterData.total_kVArh += kVArh || 0;
                meterData.total_kWh += kW || 0;
                meterData.total_kVArhTotal += kVArh || 0;

                meterData.avg_v_avg += v_avg || 0;
                meterData.avg_I_avg += I_avg || 0;
                meterData.avg_PF_avg += PF_avg || 0;

                meterData.avg_freq += freq || 0;
                meterData.avg_v_L1 += v_L1 || 0;
                meterData.avg_v_L2 += v_L2 || 0;
                meterData.avg_v_L3 += v_L3 || 0;
                meterData.avg_v_12 += v_12 || 0;
                meterData.avg_v_23 += v_23 || 0;
                meterData.avg_v_31 += v_31 || 0;
                meterData.avg_I_A1 += I_A1 || 0;
                meterData.avg_I_A2 += I_A2 || 0;
                meterData.avg_I_A3 += I_A3 || 0;

                meterData.count += 1;
              });

              request.on("done", () => {
                if (Object.keys(result).length === 0) {
                  reject(new Error("No data Hour Recorded"));
                } else {
                  // Hitung rata-rata
                  Object.values(result).forEach((meterData) => {
                    meterData.avg_v_avg = parseFloat(
                      (meterData.avg_v_avg / (meterData.count || 1)).toFixed(2)
                    );
                    meterData.avg_I_avg = parseFloat(
                      (meterData.avg_I_avg / (meterData.count || 1)).toFixed(2)
                    );
                    meterData.avg_PF_avg = parseFloat(
                      (meterData.avg_PF_avg / (meterData.count || 1)).toFixed(2)
                    );

                    meterData.avg_freq = parseFloat(
                      (meterData.avg_freq / (meterData.count || 1)).toFixed(2)
                    );
                    meterData.avg_v_L1 = parseFloat(
                      (meterData.avg_v_L1 / (meterData.count || 1)).toFixed(2)
                    );
                    meterData.avg_v_L2 = parseFloat(
                      (meterData.avg_v_L2 / (meterData.count || 1)).toFixed(2)
                    );
                    meterData.avg_v_L3 = parseFloat(
                      (meterData.avg_v_L3 / (meterData.count || 1)).toFixed(2)
                    );
                    meterData.avg_v_12 = parseFloat(
                      (meterData.avg_v_12 / (meterData.count || 1)).toFixed(2)
                    );
                    meterData.avg_v_23 = parseFloat(
                      (meterData.avg_v_23 / (meterData.count || 1)).toFixed(2)
                    );
                    meterData.avg_v_31 = parseFloat(
                      (meterData.avg_v_31 / (meterData.count || 1)).toFixed(2)
                    );
                    meterData.avg_I_A1 = parseFloat(
                      (meterData.avg_I_A1 / (meterData.count || 1)).toFixed(2)
                    );
                    meterData.avg_I_A2 = parseFloat(
                      (meterData.avg_I_A2 / (meterData.count || 1)).toFixed(2)
                    );
                    meterData.avg_I_A3 = parseFloat(
                      (meterData.avg_I_A3 / (meterData.count || 1)).toFixed(2)
                    );

                    meterData.total_kWh =
                      parseFloat(meterData.total_kWh.toFixed(2)) * 1.6;

                    meterData.total_kVArhTotal = parseFloat(
                      meterData.total_kVArhTotal.toFixed(2)
                    );

                    // Hitung total biaya
                    //const tariffPerKWh = 1000; // Tarif per kWh contoh
                    // Waktu Beban Puncak (WBP) listrik di Indonesia adalah pukul 17.00–22.00 WIB
                    // Luar Waktu Beban Puncak (LWBP) diluar jam tersebut
                    const fixTarif = TarifListrik(
                      meterData.log_waktu,
                      meterData.avg_PF_avg
                    );

                    meterData.totalCost = parseFloat(
                      (meterData.total_kWh * fixTarif).toFixed(2)
                    );

                    // delete meterData.count; // Hapus property count
                  });

                  // Tambahkan data akhir ke finalDataToSend.HourData
                  Object.keys(result).forEach((key) => {
                    const meterData = result[key];
                    const { nama_kWh_Meter, ...restData } = meterData;

                    // Tambahkan data ke HourData
                    finalDataToSend.HourData[nama_kWh_Meter] = restData;
                  });

                  resolve(finalDataToSend); // Kembalikan finalDataToSend
                }
              });

              request.on("error", (err) => {
                console.error("Error during query execution:", err);
                reject(err);
              });
            })
        )
      )
    );

    return finalDataToSend; // Mengembalikan finalDataToSend
  } catch (error) {
    console.error("Error during panel query:", error);
    throw error;
  }
};

// ========================================== END

// ====================================== CALCULATE DATA PLN
const finalAllDataHourly = async () => {
  try {
    console.log("Starting data processing...");

    // Jalankan kedua fungsi secara paralel
    const [resultPLTS, resultPanel] = await Promise.all([
      queryPLTSperJam(), // Query data untuk PLTS per jam
      queryPanelperJam(), // Query data untuk Panel per jam
    ]);

    // Log hasil data yang didapatkan
    // console.log("PLTS Data:", resultPLTS);
    // console.log("Panel Data:", resultPanel);

    // Proses data Panel (jika diperlukan)
    const processedPanelData = Object.entries(resultPanel.HourData).map(
      ([meterName, meterData]) => ({
        meterName,
        ...meterData,
        processedAt: new Date().toISOString(), // Tambahkan waktu proses
      })
    );

    const processedSolarlPVData = Object.entries(resultPLTS.HourData).map(
      ([meterName, meterData]) => ({
        meterName,
        ...meterData,
        processedAt: new Date().toISOString(), // Tambahkan waktu proses
      })
    );

    const resumeAll = (panelData, solarPVdata) => {
      // Membuat objek untuk menyimpan totalAllKWH dan totalCost
      let result = {
        totalPLNKWH: 0,
        totalPanelKWH: 0,
        totalPVKWH: 0,
        totalPLNCost: 0,
        totalPVIncome: 0,
        RECexpe: 0,
        EmisiPLN: 0,
        EEI: 0,
      };
      // console.log(solarPVdata);

      solarPVdata.forEach((data2Val) => {
        result.totalPVKWH = data2Val.total_kWh;
        result.totalPVIncome = data2Val.totalCost;
      });

      // Iterasi data menggunakan forEach
      panelData.forEach((value) => {
        // Menjumlahkan total_kWh dan totalCost untuk setiap meter
        result.totalPanelKWH += value.total_kWh;
        result.totalPLNCost += value.totalCost;

        //console.log(`${value.meterName}: total_kWh = ${value.total_kWh}`);
      });

      result.totalPLNKWH = parseFloat(
        (
          parseFloat(result.totalPanelKWH) + parseFloat(result.totalPVKWH)
        ).toFixed(2)
      );
      result.totalPLNCost = parseFloat(
        (parseFloat(result.totalPLNCost) * 0.024).toFixed(2)
      ); //0.024 pajak gak ero opo lali
      result.RECexpe = parseFloat(
        (parseFloat(result.totalPLNKWH) * tarifRECExpense).toFixed(2)
      ); //35.000 angka fix
      result.EmisiPLN =
        (parseFloat(result.totalPLNKWH).toFixed(2) * 0.87) / 1000.0; //dibagi 10000 konversi Kg ke ton
      result.EEI = parseFloat(result.totalPLNKWH).toFixed(2) * AC_AREA; // AC_area ~ 13199.79

      // Mengembalikan objek result yang berisi totalAllKWH dan totalCost

      return result;
    };

    //console.log(resumeAll(processedPanelData));

    // Kombinasikan data dari PLTS dan Panel
    const combinedData = {
      pltsData: processedSolarlPVData,
      panelData: processedPanelData,
      PLNkwh: resumeAll(processedPanelData, processedSolarlPVData),
    };

    // Log hasil akhir yang akan dikembalikan
    //console.log("Final combined data to send:", JSON.stringify(combinedData, null, 2));

    // Kembalikan data kombinasi
    return combinedData;
  } catch (error) {
    // Tangkap dan log error jika ada masalah
    console.error("Error fetching data:", error);

    // Kembalikan objek kosong jika terjadi error
    return {};
  }
};

// ============================================================= End

// ==================================================== Handler Database perjam
async function insertHourlyData(data) {
  // Fungsi Insert ke log perjam
  initializeConnectionPool().then(async () => {
    async function insertData(request, Useplts, tableName) {
      const logWaktuWIB = moment()
        .tz("Asia/Jakarta")
        .format("YYYY-MM-DD HH:mm:ss");

      // Parsing and ensuring values are formatted correctly for the table
      const parameters = {
        no_kWh_Meter: Useplts.no_kWh_Meter || null,
        nama_kWh_Meter: Useplts.meterName || null,
        v_avg: Useplts.avg_v_avg || null,
        I_avg: Useplts.avg_I_avg || null,
        PF_avg: Useplts.avg_PF_avg || null,
        kW: parseFloat(Useplts.total_kW).toFixed(2) || null,
        kVArh: parseFloat(Useplts.total_kVArhTotal).toFixed(2) || null,
        freq: Useplts.avg_freq || null,
        v_L1: Useplts.avg_v_L1 || null,
        v_L2: Useplts.avg_v_L2 || null,
        v_L3: Useplts.avg_v_L3 || null,
        v_12: Useplts.avg_v_12 || null,
        v_23: Useplts.avg_v_23 || null,
        v_31: Useplts.avg_v_31 || null,
        I_A1: Useplts.avg_I_A1 || null,
        I_A2: Useplts.avg_I_A2 || null,
        I_A3: Useplts.avg_I_A3 || null,
        log_waktu: logWaktuWIB,
        total_kWh: Useplts.total_kWh || null,
        totalCost: parseFloat(Useplts.totalCost).toFixed(2) || null,
      };

      // Construct SQL query
      const query = `
      INSERT INTO ${tableName} (
          no_kWh_Meter, nama_kWh_Meter, v_avg, I_avg, PF_avg, kW, kVArh, freq, 
          v_L1, v_L2, v_L3, v_12, v_23, v_31, I_A1, I_A2, I_A3, log_waktu, kWh_PLN, cost_PLN
      )
      VALUES (
          @no_kWh_Meter, @nama_kWh_Meter, @v_avg, @I_avg, @PF_avg, @kW, @kVArh, @freq, 
          @v_L1, @v_L2, @v_L3, @v_12, @v_23, @v_31, @I_A1, @I_A2, @I_A3, @log_waktu, 
          @total_kWh, CAST(@totalCost AS DECIMAL(18, 2))
      );
    `;

      // Bind parameters to SQL query
      for (const [key, value] of Object.entries(parameters)) {
        request.input(
          key,
          value === null
            ? sql.Null
            : typeof value === "number"
            ? sql.Float
            : sql.NVarChar,
          value
        );
      }

      // Execute the query
      try {
        await request.query(query);
        console.log(`Data successfully inserted into table: ${tableName}`);
      } catch (error) {
        console.error(`Failed to insert data into table: ${tableName}`, error);
      }
    }

    // ============================== Insert perjam management
    async function insertDataManagementperJam(request, Useplts) {
      const logWaktuWIB = moment()
        .tz("Asia/Jakarta")
        .format("YYYY-MM-DD HH:mm:ss");

      // Parsing and ensuring values are formatted correctly for the table
      const parameters = {
        totalPLNKWH: parseFloat(Useplts.totalPLNKWH).toFixed(2) || null,
        totalPanelKWH: parseFloat(Useplts.totalPanelKWH).toFixed(2) || null,
        totalPVKWH: parseFloat(Useplts.totalPVKWH).toFixed(2) || null,
        totalPLNCost: parseFloat(Useplts.totalPLNCost).toFixed(2) || null,
        totalPVIncome: parseFloat(Useplts.totalPVIncome).toFixed(2) || null,
        RECexpe: parseFloat(Useplts.RECexpe).toFixed(2) || null,
        EmisiPLN: parseFloat(Useplts.EmisiPLN).toFixed(2) || null,
        EEI: parseFloat(Useplts.EEI).toFixed(2) || null,
        log_waktu: logWaktuWIB,
      };

      //console.log(parameters);

      // Construct SQL query
      const query = `
      INSERT INTO tbl_Managementlog_perJam 
      VALUES (
          @totalPLNKWH, @totalPanelKWH, @totalPVKWH, @totalPLNCost, @totalPVIncome, @RECexpe, @EmisiPLN, @EEI, 
          @log_waktu
      );
      `;

      // Bind parameters to SQL query
      for (const [key, value] of Object.entries(parameters)) {
        request.input(
          key,
          value === null
            ? sql.Null
            : typeof value === "number"
            ? sql.Float
            : sql.NVarChar,
          value
        );
      }

      // Execute the query
      try {
        await request.query(query);
        console.log(
          `Data successfully inserted into table: [tbl_Managementlog_perJam] `
        );
      } catch (error) {
        console.error(
          `Failed to insert data into table: [tbl_Managementlog_perJam] `,
          error
        );
      }
    }

    //=============================== End

    // Main logic for insert handling data
    async function handleData(data, connectionPool) {
      const pool = await sql.connect(connectionPool);

      for (const [panelName, panelData] of Object.entries(data)) {
        if (panelName === "pltsData") {
          // Insert data for each meter in pltsData
          for (const Useplts of Object.values(panelData)) {
            //console.log(Useplts);
            const tableName = `tbl_log_${Useplts.meterName.replace(
              /[-\/\s.,]/g,
              "_"
            )}_perJam`;
            const request = pool.request(); // Create request for each insertion
            await insertData(request, Useplts, tableName);
          }
        } else if (panelName === "panelData") {
          // Group panelData by meterName
          const groupedByMeterName = Object.values(panelData).reduce(
            (acc, UsePanel) => {
              const meterName = UsePanel.meterName.replace(/[-\/\s.,]/g, "_");
              if (!acc[meterName]) {
                acc[meterName] = [];
              }
              acc[meterName].push(UsePanel);
              return acc;
            },
            {}
          );

          // Insert data for each grouped meter in panelData
          for (const meterName of Object.keys(groupedByMeterName)) {
            const panelDataForMeter = groupedByMeterName[meterName];
            for (const UsePanel of panelDataForMeter) {
              const tableName = `tbl_log_${UsePanel.meterName.replace(
                /[-\/\s.,]/g,
                "_"
              )}_perJam`;
              const request = pool.request(); // Create request for each insertion
              await insertData(request, UsePanel, tableName);
            }
          }
        } else if (panelName === "PLNkwh") {
          const request = pool.request(); // Create request for each insertion
          await insertDataManagementperJam(request, panelData);
        }
      }

      pool.release(); // Close the connection pool after all insertions
    }

    // Call the main function with your data and connection pool
    handleData(data, connectionPool);

    //create cache after insert
    const dataCache = await getCache("/calculationHour");

    if (dataCache) {
      await deleteCache("/calculationHour");

      await setCache("/calculationHour", data);
    } else {
      await setCache("/calculationHour", data);
    }
  });
}

// ======================================================= End

// ================================================ Start Calculate perDay
const queryPLTSperHari = () => {
  return new Promise((resolve, reject) => {
    try {
      const afterDekrip = {};
      const logWaktuWIB = moment().tz("Asia/Jakarta").format("YYYY-MM-DD");

      const openConn = new sql.Request(connectionPool);
      openConn.stream = true;

      const queSolarPV = `
      SELECT 
             log_waktu, 
             v_avg, I_avg, no_kWh_Meter, nama_kWh_Meter, kWh_PLN,cost_PLN
           FROM [tbl_log_kWh_PLTS_perJam]
           WHERE CONVERT(VARCHAR, log_waktu, 120) LIKE '${logWaktuWIB}%'
           ORDER BY log_waktu DESC     
      `;

      openConn.query(queSolarPV);

      openConn.on("row", (rest) => {
        const dekripData = { ...rest };

        ["v_avg", "I_avg", "kWh_PLN", "cost_PLN"].forEach((indexField) => {
          try {
            // dekripData[indexField] = parseFloat(
            //   atuwokzDecode(decodeBase64(decryptAES(rest[indexField])))
            // ); //------ Dekrip data blm di pakai
            dekripData[indexField] = parseFloat(rest[indexField]);
          } catch {
            dekripData[indexField] = 0; // Jika dekripsi gagal, set nilai ke 0
          }
        });

        //console.log(`HAHAHA`,dekripData);

        // destructuring OLD way
        const namaKWHMeter = rest.nama_kWh_Meter;
        const nokWhMeter = rest.no_kWh_Meter;
        const logWaktu = rest.log_waktu;

        const vAvgVal = dekripData.v_avg;
        const IAvgVal = dekripData.I_avg;

        const kWhPLN = dekripData.kWh_PLN;
        const costPLN = dekripData.cost_PLN;

        //            console.log(`HAHAH`,dekripData.nama_kWh_Meter);

        // Start & add data jika tidak ada maka default value 0
        if (!afterDekrip[rest.nama_kWh_Meter]) {
          afterDekrip[rest.nama_kWh_Meter] = {
            nama_kWh_Meter: namaKWHMeter,
            no_kWh_Meter: nokWhMeter,
            log_waktu: logWaktu, // Ambil log_waktu dari data pertama
            avg_v_avg: 0,
            avg_I_avg: 0,
            kWh_PLN: 0,
            cost_PLN: 0,
            count: 0,
          };
        }

        //rekonstruksi Data yang telah di enkripsi untuk di buat objectnya dan menghitung Total beserta rerata
        const dataSolarPV = afterDekrip[rest.nama_kWh_Meter];

        //console.log(`HAHAH`,dataSolarPV);

        dataSolarPV.avg_v_avg += vAvgVal || 0;
        dataSolarPV.avg_I_avg += IAvgVal || 0;
        dataSolarPV.kWh_PLN += kWhPLN || 0;
        dataSolarPV.cost_PLN += costPLN || 0;

        dataSolarPV.count += 1; //hitung total data yang masuk untuk pembagian rata-rata
      });

      openConn.on("done", () => {
        if (Object.keys(afterDekrip).length === 0) {
          throw new Error("No data Daily SolarPV Recorded");
        } else {
          Object.values(afterDekrip).forEach((LastdataSolarPV) => {
            //console.log(`HAHAH`,LastdataSolarPV.avg_v_avg);
            LastdataSolarPV.avg_v_avg = parseFloat(
              LastdataSolarPV.avg_v_avg / (LastdataSolarPV.count || 1)
            ).toFixed(2);
            LastdataSolarPV.avg_I_avg = parseFloat(
              LastdataSolarPV.avg_I_avg / (LastdataSolarPV.count || 1)
            ).toFixed(2);

            // Format total kWh dan total kVArh agar memiliki 2 angka desimal
            LastdataSolarPV.kWh_PLN = parseFloat(
              LastdataSolarPV.kWh_PLN
            ).toFixed(2);

            // Menghitung biaya total (total kWh * tarif dasar)
            LastdataSolarPV.cost_PLN = parseFloat(
              LastdataSolarPV.cost_PLN
            ).toFixed(2);

            delete LastdataSolarPV.count;
          });
        }

        Object.keys(afterDekrip).forEach((key) => {
          const keySolarPVdata = afterDekrip[key];
          const { nama_kWh_Meter, ...restData } = keySolarPVdata;

          // Menambahkan data ke HourData dengan nama_kWh_Meter sebagai kunci
          finalDataToSolarPVDaily.DailyData[nama_kWh_Meter] = restData;
          //console.log(finalDataToSolarPVDaily);
          resolve(finalDataToSolarPVDaily);
        });
      });
    } catch (err) {
      reject(err);
    }
  });
};

const queryPanelperHari = async () => {
  //const finalDataToSendDaily = { HourData: {} }; // Inisialisasi finalDataToSend
  try {
    // Mulai pemrosesan dengan map sanitasi tabel
    await Promise.all(
      sanitizedTableNamesCache.map((tableName) =>
        retryOperation(
          () =>
            new Promise((resolve, reject) => {
              const logWaktuWIB = moment()
                .tz("Asia/Jakarta")
                .format("YYYY-MM-DD");

              const request = new sql.Request(connectionPool);
              const result = {}; // Menyimpan hasil berdasarkan nama_kWh_Meter

              request.stream = true;

              // Query untuk mendapatkan data perjam terakhir
              request.query(
                `SELECT 
             log_waktu, 
             v_avg, I_avg,kW, PF_avg, kVArh,freq,no_kWh_Meter, nama_kWh_Meter, kWh_PLN,cost_PLN
           FROM ${tableName}_perJam
           WHERE CONVERT(VARCHAR, log_waktu, 120) LIKE '${logWaktuWIB}%'
           ORDER BY log_waktu DESC`
              );

              //     console.log(`SELECT
              //    log_waktu,
              //    v_avg, I_avg,kW, PF_avg, kVArh,freq,no_kWh_Meter, nama_kWh_Meter, kWh_PLN,cost_PLN
              //  FROM ${tableName}_perJam
              //  WHERE CONVERT(VARCHAR, log_waktu, 120) LIKE '${logWaktuWIB}%'
              //  ORDER BY log_waktu DESC`);

              // Proses data saat row datang
              request.on("row", (row) => {
                const decryptedRow = { ...row };
                // Dekripsi dan parse field numerik
                [
                  "kW",
                  "kVArh",
                  "PF_avg",
                  "v_avg",
                  "I_avg",
                  "freq",
                  "kWh_PLN",
                  "cost_PLN",
                ].forEach((field) => {
                  try {
                    // decryptedRow[field] = parseFloat(
                    //   atuwokzDecode(decodeBase64(decryptAES(row[field])))
                    // ); //blm di pakai
                    decryptedRow[field] = parseFloat(row[field]);
                  } catch {
                    decryptedRow[field] = 0; // Jika dekripsi gagal, set ke 0
                  }
                });
                //console.log(decryptedRow);

                // Extract field yang diperlukan
                const {
                  nama_kWh_Meter,
                  no_kWh_Meter,
                  log_waktu,
                  kW,
                  kVArh,
                  v_avg,
                  I_avg,
                  PF_avg,
                  freq,
                  kWh_PLN,
                  cost_PLN,
                } = decryptedRow;

                // Destructuring new WAY data meter jika belum ada
                if (!result[nama_kWh_Meter]) {
                  result[nama_kWh_Meter] = {
                    nama_kWh_Meter,
                    no_kWh_Meter,
                    log_waktu,
                    total_kVArh: 0,
                    total_kWh: 0,
                    total_kVArhTotal: 0,
                    avg_v_avg: 0,
                    avg_I_avg: 0,
                    avg_PF_avg: 0,
                    count: 0,
                    totalCost: 0,
                    avg_freq: 0,
                    kWhPLN: 0,
                    costPLN: 0,
                  };
                }

                // Update data meter
                const meterData = result[nama_kWh_Meter];
                meterData.total_kVArh += kVArh || 0;
                meterData.total_kWh += kW || 0;

                meterData.avg_v_avg += v_avg || 0;
                meterData.avg_I_avg += I_avg || 0;
                meterData.avg_PF_avg += PF_avg || 0;

                meterData.avg_freq += freq || 0;

                meterData.kWhPLN += kWh_PLN || 0;
                meterData.costPLN += cost_PLN || 0;

                meterData.count += 1;
              });

              request.on("done", () => {
                if (Object.keys(result).length === 0) {
                  reject(new Error("No data Daily Recorded"));
                } else {
                  // Hitung rata-rata
                  Object.values(result).forEach((meterData) => {
                    meterData.avg_v_avg = parseFloat(
                      (meterData.avg_v_avg / (meterData.count || 1)).toFixed(2)
                    );
                    meterData.avg_I_avg = parseFloat(
                      (meterData.avg_I_avg / (meterData.count || 1)).toFixed(2)
                    );
                    meterData.avg_PF_avg = parseFloat(
                      (meterData.avg_PF_avg / (meterData.count || 1)).toFixed(2)
                    );

                    meterData.avg_freq = parseFloat(
                      (meterData.avg_freq / (meterData.count || 1)).toFixed(2)
                    );

                    meterData.total_kWh = parseFloat(
                      meterData.total_kWh
                    ).toFixed(2);

                    meterData.total_kVArhTotal = parseFloat(
                      meterData.total_kVArhTotal
                    ).toFixed(2);

                    meterData.kWhPLN = parseFloat(meterData.kWhPLN).toFixed(2);
                    meterData.totalCost = parseFloat(
                      meterData.totalCost
                    ).toFixed(2);

                    // delete meterData.count; // Hapus property count
                  });

                  // Tambahkan data akhir ke finalDataToSend.HourData
                  Object.keys(result).forEach((key) => {
                    const meterData = result[key];
                    const { nama_kWh_Meter, ...restData } = meterData;

                    // Tambahkan data ke HourData
                    finalDataToSendDaily.DailyData[nama_kWh_Meter] = restData;
                  });
                  //console.log(finalDataToSendDaily);
                  resolve(finalDataToSendDaily); // Kembalikan finalDataToSend
                }
              });

              request.on("error", (err) => {
                console.error("Error during query Daily execution:", err);
                reject(err);
              });
            })
        )
      )
    );

    return finalDataToSendDaily; // Mengembalikan finalDataToSend
  } catch (error) {
    console.error("Error during panel Daily query:", error);
    throw error;
  }
};

const queryDataManagementperHari = () => {
  return new Promise((resolve, reject) => {
    try {
      const afterDekrip = {};
      const logWaktuWIB = moment().tz("Asia/Jakarta").format("YYYY-MM-DD");

      const openConn = new sql.Request(connectionPool);
      openConn.stream = true;

      const queDataMan = `
           SELECT 
             [totalPLNKWH]
            ,[totalPanelKWH]
            ,[totalPVKWH]
            ,[totalPLNCost]
            ,[totalPVIncome]
            ,[RECexpe]
            ,[EmisiPLN]
            ,[EEI]
            ,[log_waktu]
           FROM [tbl_Managementlog_perJam]
           WHERE CONVERT(VARCHAR, log_waktu, 120) LIKE '${logWaktuWIB}%'
           ORDER BY log_waktu DESC     
      `;

      openConn.query(queDataMan);

      openConn.on("row", (rest) => {
        const dekripData = { ...rest };

        [
          "totalPLNKWH",
          "totalPanelKWH",
          "totalPVKWH",
          "totalPLNCost",
          "totalPVIncome",
          "RECexpe",
          "EmisiPLN",
          "EEI",
        ].forEach((indexField) => {
          try {
            // dekripData[indexField] = parseFloat(
            //   atuwokzDecode(decodeBase64(decryptAES(rest[indexField])))
            // ); //------ Dekrip data blm di pakai
            dekripData[indexField] = parseFloat(rest[indexField]);
          } catch {
            dekripData[indexField] = 0; // Jika dekripsi gagal, set nilai ke 0
          }
        });

        //console.log(`HAHAHA`,dekripData);

        // destructuring OLD way
        const totalPLNKWH = dekripData.totalPLNKWH;
        const totalPanelKWH = dekripData.totalPanelKWH;
        const totalPVKWH = dekripData.totalPVKWH;
        const totalPLNCost = dekripData.totalPLNCost;
        const totalPVIncome = dekripData.totalPVIncome;
        const RECexpe = dekripData.RECexpe;
        const EmisiPLN = dekripData.EmisiPLN;
        const EEIx = dekripData.EEI;
        const logWaktu = rest.log_waktu;

        //            console.log(`HAHAH`,dekripData.nama_kWh_Meter);

        // Start & add data jika tidak ada maka default value 0
        if (!afterDekrip[rest]) {
          afterDekrip[rest] = {
            totalPLNKWH: 0,
            totalPanelKWH: 0,
            totalPVKWH: 0,
            totalPLNCost: 0,
            totalPVIncome: 0,
            RECexpe: 0,
            EmisiPLN: 0,
            EEI: 0,
            logWaktu: logWaktu,
            count: 0,
          };
        }

        //rekonstruksi Data yang telah di enkripsi untuk di buat objectnya dan menghitung Total beserta rerata
        const dataDailyMan = afterDekrip[rest];

        //console.log(`HAHAH`,dataSolarPV);

        dataDailyMan.totalPLNKWH += totalPLNKWH || 0;
        dataDailyMan.totalPanelKWH += totalPanelKWH || 0;
        dataDailyMan.totalPVKWH += totalPVKWH || 0;
        dataDailyMan.totalPLNCost += totalPLNCost || 0;
        dataDailyMan.totalPVIncome += totalPVIncome || 0;
        dataDailyMan.RECexpe += RECexpe || 0;
        dataDailyMan.EmisiPLN += EmisiPLN || 0;
        dataDailyMan.EEI += EEIx || 0;

        dataDailyMan.count += 1; //hitung total data yang masuk untuk pembagian rata-rata
      });

      openConn.on("done", () => {
        if (Object.keys(afterDekrip).length === 0) {
          throw new Error("No data Daily Management Recorded");
        } else {
          Object.values(afterDekrip).forEach((LastdataMan) => {
            //console.log(`HAHAH`,LastdataSolarPV.avg_v_avg);

            LastdataMan.totalPLNKWH = parseFloat(
              LastdataMan.totalPLNKWH
            ).toFixed(2);
            LastdataMan.totalPanelKWH = parseFloat(
              LastdataMan.totalPanelKWH
            ).toFixed(2);
            LastdataMan.totalPVKWH = parseFloat(LastdataMan.totalPVKWH).toFixed(
              2
            );
            LastdataMan.totalPLNCost = parseFloat(
              LastdataMan.totalPLNCost
            ).toFixed(2);
            LastdataMan.totalPVIncome = parseFloat(
              LastdataMan.totalPVIncome
            ).toFixed(2);
            LastdataMan.RECexpe = parseFloat(LastdataMan.RECexpe).toFixed(2);
            LastdataMan.EmisiPLN = parseFloat(LastdataMan.EmisiPLN).toFixed(2);
            LastdataMan.EEI = parseFloat(LastdataMan.EEI).toFixed(2);

            //delete LastdataSolarPV.count;
          });
        }

        Object.keys(afterDekrip).forEach((key) => {
          const keydataMan = afterDekrip[key];
          const { ...restData } = keydataMan;

          // Menambahkan data ke HourData dengan nama_kWh_Meter sebagai kunci
          finalManDataDaily.DailyData = restData;
          //console.log(finalManDataDaily);
          resolve(finalManDataDaily);
        });
      });
    } catch (err) {
      reject(err);
    }
  });
};

const finalAllDataDaily = async () => {
  try {
    console.log("Starting data processing...");

    // Jalankan kedua fungsi secara paralel
    const [resultPLTS, resultPanel, resultManagement] = await Promise.all([
      queryPLTSperHari(), // Query data untuk PLTS
      queryPanelperHari(), // Query data untuk Panel
      queryDataManagementperHari(),
    ]);

    // Log hasil data yang didapatkan
    // console.log("PLTS Data:", resultPLTS);
    // console.log("Panel Data:", resultPanel);

    // Proses data Panel (jika diperlukan)
    const processedPanelData = Object.entries(resultPanel.DailyData).map(
      ([meterName, meterData]) => ({
        meterName,
        ...meterData,
        processedAt: new Date().toISOString(), // Tambahkan waktu proses
      })
    );

    const processedSolarlPVData = Object.entries(resultPLTS.DailyData).map(
      ([meterName, meterData]) => ({
        meterName,
        ...meterData,
        processedAt: new Date().toISOString(), // Tambahkan waktu proses
      })
    );

    // Kombinasikan data dari PLTS dan Panel
    const combinedData = {
      pltsData: processedSolarlPVData,
      panelData: processedPanelData,
      PLNkwh: resultManagement,
    };

    // Log hasil akhir yang akan dikembalikan
    //console.log("Final combined data to send:", JSON.stringify(combinedData, null, 2));

    // Kembalikan data kombinasi
    return combinedData;
  } catch (error) {
    // Tangkap dan log error jika ada masalah
    console.error("Error fetching data:", error);

    // Kembalikan objek kosong jika terjadi error
    return {};
  }
};

async function insertDailyData(data) {
  // Fungsi Insert ke log perjam
  initializeConnectionPool().then(async () => {
    async function insertDataPLTS(request, Useplts, tableName) {
      const logWaktuWIB = moment()
        .tz("Asia/Jakarta")
        .format("YYYY-MM-DD HH:mm:ss");

      // Parsing and ensuring values are formatted correctly for the table
      const parameters = {
        no_kWh_Meter: Useplts.no_kWh_Meter || null,
        nama_kWh_Meter: Useplts.meterName || null,
        v_avg: Useplts.avg_v_avg
          ? parseFloat(Useplts.avg_v_avg).toFixed(2)
          : null,
        I_avg: Useplts.avg_I_avg
          ? parseFloat(Useplts.avg_I_avg).toFixed(2)
          : null,
        log_waktu: logWaktuWIB,
        kWh_PLN: Useplts.kWh_PLN
          ? parseFloat(Useplts.kWh_PLN).toFixed(2)
          : null,
        cost_PLN: Useplts.cost_PLN
          ? parseFloat(Useplts.cost_PLN).toFixed(2)
          : null,
      };
      // console.log(`ZAZAZS`,parameters);

      // Construct SQL query
      const query = `
      INSERT INTO ${tableName} (
          no_kWh_Meter, nama_kWh_Meter, v_avg, I_avg, 
          log_waktu, kWh_PLN, cost_PLN
      )
      VALUES (
          @no_kWh_Meter, @nama_kWh_Meter, @v_avg, @I_avg,  
           CONVERT(VARCHAR, @log_waktu, 120),@kWh_PLN, CAST(@cost_PLN AS DECIMAL(18, 2))
      );
    `;

      // Bind parameters to SQL query
      for (const [key, value] of Object.entries(parameters)) {
        request.input(
          key,
          value === null
            ? sql.Null
            : typeof value === "number"
            ? sql.Float
            : sql.NVarChar,
          value
        );
      }

      // Execute the query
      try {
        await request.query(query);
        console.log(`Data successfully inserted into table: ${tableName}`);
      } catch (error) {
        console.error(`Failed to insert data into table: ${tableName}`, error);
      }
    }

    async function insertData(request, Useplts, tableName) {
      const logWaktuWIB = moment()
        .tz("Asia/Jakarta")
        .format("YYYY-MM-DD HH:mm:ss");

      // Parsing and ensuring values are formatted correctly for the table
      const parameters = {
        no_kWh_Meter: Useplts.no_kWh_Meter || null,
        nama_kWh_Meter: Useplts.meterName || null,
        v_avg: parseFloat(Useplts.avg_v_avg).toFixed(2) || null,
        I_avg: parseFloat(Useplts.avg_I_avg).toFixed(2) || null,
        PF_avg: parseFloat(Useplts.avg_PF_avg).toFixed(2) || null,
        kW: parseFloat(Useplts.total_kW).toFixed(2) || null,
        kVArh: parseFloat(Useplts.total_kVArhTotal).toFixed(2) || null,
        freq: parseFloat(Useplts.avg_freq).toFixed(2) || null,
        log_waktu: logWaktuWIB,
        total_kWh: parseFloat(Useplts.kWhPLN).toFixed(2) || null,
        costPLN: parseFloat(Useplts.costPLN).toFixed(2) || null,
      };
      //console.log(parameters);

      // Construct SQL query
      const query = `
      INSERT INTO ${tableName} (
          no_kWh_Meter, nama_kWh_Meter, v_avg, I_avg, PF_avg, kW, kVArh, freq, 
          log_waktu, kWh_PLN, cost_PLN
      )
      VALUES (
          @no_kWh_Meter, @nama_kWh_Meter, @v_avg, @I_avg, @PF_avg, @kW, @kVArh, @freq,  
           CONVERT(VARCHAR, @log_waktu, 120),@total_kWh, CAST(@costPLN AS DECIMAL(18, 2))
      );
    `;

      // Bind parameters to SQL query
      for (const [key, value] of Object.entries(parameters)) {
        request.input(
          key,
          value === null
            ? sql.Null
            : typeof value === "number"
            ? sql.Float
            : sql.NVarChar,
          value
        );
      }

      // Execute the query
      try {
        await request.query(query);
        console.log(`Data successfully inserted into table: ${tableName}`);
      } catch (error) {
        console.error(`Failed to insert data into table: ${tableName}`, error);
      }
    }

    // ============================== Insert perjam management
    async function insertDataManagementperHari(request, Useplts) {
      const logWaktuWIB = moment()
        .tz("Asia/Jakarta")
        .format("YYYY-MM-DD HH:mm:ss");

      // Parsing and ensuring values are formatted correctly for the table
      const parameters = {
        totalPLNKWH: parseFloat(Useplts.totalPLNKWH).toFixed(2) || null,
        totalPanelKWH: parseFloat(Useplts.totalPanelKWH).toFixed(2) || null,
        totalPVKWH: parseFloat(Useplts.totalPVKWH).toFixed(2) || null,
        totalPLNCost: parseFloat(Useplts.totalPLNCost).toFixed(2) || null,
        totalPVIncome: parseFloat(Useplts.totalPVIncome).toFixed(2) || null,
        RECexpe: parseFloat(Useplts.RECexpe).toFixed(2) || null,
        EmisiPLN: parseFloat(Useplts.EmisiPLN).toFixed(2) || null,
        EEI: parseFloat(Useplts.EEI).toFixed(2) || null,
        log_waktu: logWaktuWIB,
      };

      // console.log(parameters);

      // Construct SQL query
      const query = `
      INSERT INTO tbl_Managementlog_perHari
      VALUES (
          @totalPLNKWH, @totalPanelKWH, @totalPVKWH, @totalPLNCost, @totalPVIncome, @RECexpe, @EmisiPLN, @EEI, 
          @log_waktu
      );
      `;

      // Bind parameters to SQL query
      for (const [key, value] of Object.entries(parameters)) {
        request.input(
          key,
          value === null
            ? sql.Null
            : typeof value === "number"
            ? sql.Float
            : sql.NVarChar,
          value
        );
      }

      // Execute the query
      try {
        await request.query(query);
        console.log(
          `Data successfully inserted into table: [tbl_Managementlog_perHari] `
        );
      } catch (error) {
        console.error(
          `Failed to insert data into table: [tbl_Managementlog_perHari] `,
          error
        );
      }
    }

    //=============================== End

    // Main logic for insert handling data
    async function handleData(data, connectionPool) {
      const pool = await sql.connect(connectionPool);
      //console.log(`ZAZAZA`,data);

      for (const [panelName, panelData] of Object.entries(data)) {
        if (panelName === "pltsData") {
          // Insert data for each meter in pltsData
          for (const Useplts of Object.values(panelData)) {
            const tableName = `tbl_log_${Useplts.meterName.replace(
              /[-\/\s.,]/g,
              "_"
            )}_perHari`;
            const request = pool.request(); // Create request for each insertion

            await insertDataPLTS(request, Useplts, tableName);
          }
        } else if (panelName === "panelData") {
          // Group panelData by meterName
          const groupedByMeterName = Object.values(panelData).reduce(
            (acc, UsePanel) => {
              const meterName = UsePanel.meterName.replace(/[-\/\s.,]/g, "_");
              if (!acc[meterName]) {
                acc[meterName] = [];
              }
              acc[meterName].push(UsePanel);
              return acc;
            },
            {}
          );

          // Insert data for each grouped meter in panelData
          for (const meterName of Object.keys(groupedByMeterName)) {
            const panelDataForMeter = groupedByMeterName[meterName];
            for (const UsePanel of panelDataForMeter) {
              const tableName = `tbl_log_${UsePanel.meterName.replace(
                /[-\/\s.,]/g,
                "_"
              )}_perHari`;
              const request = pool.request(); // Create request for each insertion
              await insertData(request, UsePanel, tableName);
            }
          }
        } else if (panelName === "PLNkwh") {
          const request = pool.request(); // Create request for each insertion

          await insertDataManagementperHari(request, panelData.DailyData);
        }
      }

      pool.release(); // Close the connection pool after all insertions
    }

    // Call the main function with your data and connection pool
    handleData(data, connectionPool);

    //create cache after insert
    const dataCache = await getCache("/calculationDaily");

    if (dataCache) {
      await deleteCache("/calculationDaily");

      await setCache("/calculationDaily", data);
    } else {
      await setCache("/calculationDaily", data);
    }
  });
}

// ==================================================== End

// ================================================ Start Calculate perMonth
const queryPLTSperBulan = () => {
  return new Promise((resolve, reject) => {
    try {
      const afterDekrip = {};
      const logWaktuWIB = moment().tz("Asia/Jakarta").format("YYYY-MM");

      const openConn = new sql.Request(connectionPool);
      openConn.stream = true;

      const queSolarPV = `
      SELECT 
             log_waktu, 
             v_avg, I_avg, no_kWh_Meter, nama_kWh_Meter, kWh_PLN,cost_PLN
           FROM [tbl_log_kWh_PLTS_perHari]
           WHERE CONVERT(VARCHAR, log_waktu, 120) LIKE '${logWaktuWIB}%'
           ORDER BY log_waktu DESC     
      `;

      openConn.query(queSolarPV);

      openConn.on("row", (rest) => {
        const dekripData = { ...rest };

        ["v_avg", "I_avg", "kWh_PLN", "cost_PLN"].forEach((indexField) => {
          try {
            // dekripData[indexField] = parseFloat(
            //   atuwokzDecode(decodeBase64(decryptAES(rest[indexField])))
            // ); //------ Dekrip data blm di pakai
            dekripData[indexField] = parseFloat(rest[indexField]);
          } catch {
            dekripData[indexField] = 0; // Jika dekripsi gagal, set nilai ke 0
          }
        });

        //console.log(`HAHAHA`,dekripData);

        // destructuring OLD way
        const namaKWHMeter = rest.nama_kWh_Meter;
        const nokWhMeter = rest.no_kWh_Meter;
        const logWaktu = rest.log_waktu;

        const vAvgVal = dekripData.v_avg;
        const IAvgVal = dekripData.I_avg;

        const kWhPLN = dekripData.kWh_PLN;
        const costPLN = dekripData.cost_PLN;

        //            console.log(`HAHAH`,dekripData.nama_kWh_Meter);

        // Start & add data jika tidak ada maka default value 0
        if (!afterDekrip[rest.nama_kWh_Meter]) {
          afterDekrip[rest.nama_kWh_Meter] = {
            nama_kWh_Meter: namaKWHMeter,
            no_kWh_Meter: nokWhMeter,
            log_waktu: logWaktu, // Ambil log_waktu dari data pertama
            avg_v_avg: 0,
            avg_I_avg: 0,
            kWh_PLN: 0,
            cost_PLN: 0,
            count: 0,
          };
        }

        //rekonstruksi Data yang telah di enkripsi untuk di buat objectnya dan menghitung Total beserta rerata
        const dataSolarPV = afterDekrip[rest.nama_kWh_Meter];

        //console.log(`HAHAH`,dataSolarPV);

        dataSolarPV.avg_v_avg += vAvgVal || 0;
        dataSolarPV.avg_I_avg += IAvgVal || 0;
        dataSolarPV.kWh_PLN += kWhPLN || 0;
        dataSolarPV.cost_PLN += costPLN || 0;

        dataSolarPV.count += 1; //hitung total data yang masuk untuk pembagian rata-rata
      });

      openConn.on("done", () => {
        if (Object.keys(afterDekrip).length === 0) {
          throw new Error("No data Montly SolarPV Recorded");
        } else {
          Object.values(afterDekrip).forEach((LastdataSolarPV) => {
            //console.log(`HAHAH`,LastdataSolarPV.avg_v_avg);
            LastdataSolarPV.avg_v_avg = parseFloat(
              LastdataSolarPV.avg_v_avg / (LastdataSolarPV.count || 1)
            ).toFixed(2);
            LastdataSolarPV.avg_I_avg = parseFloat(
              LastdataSolarPV.avg_I_avg / (LastdataSolarPV.count || 1)
            ).toFixed(2);

            // Format total kWh dan total kVArh agar memiliki 2 angka desimal
            LastdataSolarPV.kWh_PLN = parseFloat(
              LastdataSolarPV.kWh_PLN
            ).toFixed(2);

            // Menghitung biaya total (total kWh * tarif dasar)
            LastdataSolarPV.cost_PLN = parseFloat(
              LastdataSolarPV.cost_PLN
            ).toFixed(2);

            delete LastdataSolarPV.count;
          });
        }

        Object.keys(afterDekrip).forEach((key) => {
          const keySolarPVdata = afterDekrip[key];
          const { nama_kWh_Meter, ...restData } = keySolarPVdata;

          // Menambahkan data ke HourData dengan nama_kWh_Meter sebagai kunci
          finalDataToSolarPVMonthly.MonthlyData[nama_kWh_Meter] = restData;
          //console.log(finalDataToSolarPVDaily);
          resolve(finalDataToSolarPVMonthly);
        });
      });
    } catch (err) {
      reject(err);
    }
  });
};

const queryPanelperBulan = async () => {
  //const finalDataToSendDaily = { HourData: {} }; // Inisialisasi finalDataToSend
  try {
    // Mulai pemrosesan dengan map sanitasi tabel
    await Promise.all(
      sanitizedTableNamesCache.map((tableName) =>
        retryOperation(
          () =>
            new Promise((resolve, reject) => {
              const logWaktuWIB = moment().tz("Asia/Jakarta").format("YYYY-MM");

              const request = new sql.Request(connectionPool);
              const result = {}; // Menyimpan hasil berdasarkan nama_kWh_Meter

              request.stream = true;

              // Query untuk mendapatkan data perjam terakhir
              request.query(
                `SELECT 
             log_waktu, 
             v_avg, I_avg,kW, PF_avg, kVArh,freq,no_kWh_Meter, nama_kWh_Meter, kWh_PLN,cost_PLN
           FROM ${tableName}_perHari
           WHERE CONVERT(VARCHAR, log_waktu, 120) LIKE '${logWaktuWIB}%'
           ORDER BY log_waktu DESC`
              );

              //     console.log(`SELECT
              //    log_waktu,
              //    v_avg, I_avg,kW, PF_avg, kVArh,freq,no_kWh_Meter, nama_kWh_Meter, kWh_PLN,cost_PLN
              //  FROM ${tableName}_perJam
              //  WHERE CONVERT(VARCHAR, log_waktu, 120) LIKE '${logWaktuWIB}%'
              //  ORDER BY log_waktu DESC`);

              // Proses data saat row datang
              request.on("row", (row) => {
                const decryptedRow = { ...row };
                // Dekripsi dan parse field numerik
                [
                  "kW",
                  "kVArh",
                  "PF_avg",
                  "v_avg",
                  "I_avg",
                  "freq",
                  "kWh_PLN",
                  "cost_PLN",
                ].forEach((field) => {
                  try {
                    // decryptedRow[field] = parseFloat(
                    //   atuwokzDecode(decodeBase64(decryptAES(row[field])))
                    // ); //blm di pakai
                    decryptedRow[field] = parseFloat(row[field]);
                  } catch {
                    decryptedRow[field] = 0; // Jika dekripsi gagal, set ke 0
                  }
                });
                //console.log(decryptedRow);

                // Extract field yang diperlukan
                const {
                  nama_kWh_Meter,
                  no_kWh_Meter,
                  log_waktu,
                  kW,
                  kVArh,
                  v_avg,
                  I_avg,
                  PF_avg,
                  freq,
                  kWh_PLN,
                  cost_PLN,
                } = decryptedRow;

                // Destructuring new WAY data meter jika belum ada
                if (!result[nama_kWh_Meter]) {
                  result[nama_kWh_Meter] = {
                    nama_kWh_Meter,
                    no_kWh_Meter,
                    log_waktu,
                    total_kVArh: 0,
                    total_kWh: 0,
                    total_kVArhTotal: 0,
                    avg_v_avg: 0,
                    avg_I_avg: 0,
                    avg_PF_avg: 0,
                    count: 0,
                    totalCost: 0,
                    avg_freq: 0,
                    kWhPLN: 0,
                    costPLN: 0,
                  };
                }

                // Update data meter
                const meterData = result[nama_kWh_Meter];
                meterData.total_kVArh += kVArh || 0;
                meterData.total_kWh += kW || 0;

                meterData.avg_v_avg += v_avg || 0;
                meterData.avg_I_avg += I_avg || 0;
                meterData.avg_PF_avg += PF_avg || 0;

                meterData.avg_freq += freq || 0;

                meterData.kWhPLN += kWh_PLN || 0;
                meterData.costPLN += cost_PLN || 0;

                meterData.count += 1;
              });

              request.on("done", () => {
                if (Object.keys(result).length === 0) {
                  reject(new Error("No data Monthly Recorded"));
                } else {
                  // Hitung rata-rata
                  Object.values(result).forEach((meterData) => {
                    meterData.avg_v_avg = parseFloat(
                      (meterData.avg_v_avg / (meterData.count || 1)).toFixed(2)
                    );
                    meterData.avg_I_avg = parseFloat(
                      (meterData.avg_I_avg / (meterData.count || 1)).toFixed(2)
                    );
                    meterData.avg_PF_avg = parseFloat(
                      (meterData.avg_PF_avg / (meterData.count || 1)).toFixed(2)
                    );

                    meterData.avg_freq = parseFloat(
                      (meterData.avg_freq / (meterData.count || 1)).toFixed(2)
                    );

                    meterData.total_kWh = parseFloat(
                      meterData.total_kWh
                    ).toFixed(2);

                    meterData.total_kVArhTotal = parseFloat(
                      meterData.total_kVArhTotal
                    ).toFixed(2);

                    meterData.kWhPLN = parseFloat(meterData.kWhPLN).toFixed(2);
                    meterData.totalCost = parseFloat(
                      meterData.totalCost
                    ).toFixed(2);

                    // delete meterData.count; // Hapus property count
                  });

                  // Tambahkan data akhir ke finalDataToSend.HourData
                  Object.keys(result).forEach((key) => {
                    const meterData = result[key];
                    const { nama_kWh_Meter, ...restData } = meterData;

                    // Tambahkan data ke HourData
                    finalDataToSendMonthly.MonthlyData[nama_kWh_Meter] =
                      restData;
                  });
                  //console.log(finalDataToSendDaily);
                  resolve(finalDataToSendMonthly); // Kembalikan finalDataToSend
                }
              });

              request.on("error", (err) => {
                console.error("Error during query Monthly execution:", err);
                reject(err);
              });
            })
        )
      )
    );

    return finalDataToSendMonthly; // Mengembalikan finalDataToSend
  } catch (error) {
    console.error("Error during panel Monthly query:", error);
    throw error;
  }
};

const queryDataManagementperBulan = () => {
  return new Promise((resolve, reject) => {
    try {
      const afterDekrip = {};
      const logWaktuWIB = moment().tz("Asia/Jakarta").format("YYYY-MM");

      const openConn = new sql.Request(connectionPool);
      openConn.stream = true;

      const queDataMan = `
           SELECT 
             [totalPLNKWH]
            ,[totalPanelKWH]
            ,[totalPVKWH]
            ,[totalPLNCost]
            ,[totalPVIncome]
            ,[RECexpe]
            ,[EmisiPLN]
            ,[EEI]
            ,[log_waktu]
           FROM [tbl_Managementlog_perHari]
           WHERE CONVERT(VARCHAR, log_waktu, 120) LIKE '${logWaktuWIB}%'
           ORDER BY log_waktu DESC     
      `;

      openConn.query(queDataMan);

      openConn.on("row", (rest) => {
        const dekripData = { ...rest };

        [
          "totalPLNKWH",
          "totalPanelKWH",
          "totalPVKWH",
          "totalPLNCost",
          "totalPVIncome",
          "RECexpe",
          "EmisiPLN",
          "EEI",
        ].forEach((indexField) => {
          try {
            // dekripData[indexField] = parseFloat(
            //   atuwokzDecode(decodeBase64(decryptAES(rest[indexField])))
            // ); //------ Dekrip data blm di pakai
            dekripData[indexField] = parseFloat(rest[indexField]);
          } catch {
            dekripData[indexField] = 0; // Jika dekripsi gagal, set nilai ke 0
          }
        });

        //console.log(`HAHAHA`,dekripData);

        // destructuring OLD way
        const totalPLNKWH = dekripData.totalPLNKWH;
        const totalPanelKWH = dekripData.totalPanelKWH;
        const totalPVKWH = dekripData.totalPVKWH;
        const totalPLNCost = dekripData.totalPLNCost;
        const totalPVIncome = dekripData.totalPVIncome;
        const RECexpe = dekripData.RECexpe;
        const EmisiPLN = dekripData.EmisiPLN;
        const EEIx = dekripData.EEI;
        const logWaktu = rest.log_waktu;

        //            console.log(`HAHAH`,dekripData.nama_kWh_Meter);

        // Start & add data jika tidak ada maka default value 0
        if (!afterDekrip[rest]) {
          afterDekrip[rest] = {
            totalPLNKWH: 0,
            totalPanelKWH: 0,
            totalPVKWH: 0,
            totalPLNCost: 0,
            totalPVIncome: 0,
            RECexpe: 0,
            EmisiPLN: 0,
            EEI: 0,
            logWaktu: logWaktu,
            count: 0,
          };
        }

        //rekonstruksi Data yang telah di enkripsi untuk di buat objectnya dan menghitung Total beserta rerata
        const dataDailyMan = afterDekrip[rest];

        //console.log(`HAHAH`,dataSolarPV);

        dataDailyMan.totalPLNKWH += totalPLNKWH || 0;
        dataDailyMan.totalPanelKWH += totalPanelKWH || 0;
        dataDailyMan.totalPVKWH += totalPVKWH || 0;
        dataDailyMan.totalPLNCost += totalPLNCost || 0;
        dataDailyMan.totalPVIncome += totalPVIncome || 0;
        dataDailyMan.RECexpe += RECexpe || 0;
        dataDailyMan.EmisiPLN += EmisiPLN || 0;
        dataDailyMan.EEI += EEIx || 0;

        dataDailyMan.count += 1; //hitung total data yang masuk untuk pembagian rata-rata
      });

      openConn.on("done", () => {
        if (Object.keys(afterDekrip).length === 0) {
          throw new Error("No data Daily Management Recorded");
        } else {
          Object.values(afterDekrip).forEach((LastdataMan) => {
            //console.log(`HAHAH`,LastdataSolarPV.avg_v_avg);

            LastdataMan.totalPLNKWH = parseFloat(
              LastdataMan.totalPLNKWH
            ).toFixed(2);
            LastdataMan.totalPanelKWH = parseFloat(
              LastdataMan.totalPanelKWH
            ).toFixed(2);
            LastdataMan.totalPVKWH = parseFloat(LastdataMan.totalPVKWH).toFixed(
              2
            );
            LastdataMan.totalPLNCost = parseFloat(
              LastdataMan.totalPLNCost
            ).toFixed(2);
            LastdataMan.totalPVIncome = parseFloat(
              LastdataMan.totalPVIncome
            ).toFixed(2);
            LastdataMan.RECexpe = parseFloat(LastdataMan.RECexpe).toFixed(2);
            LastdataMan.EmisiPLN = parseFloat(LastdataMan.EmisiPLN).toFixed(2);
            LastdataMan.EEI = parseFloat(LastdataMan.EEI).toFixed(2);

            //delete LastdataSolarPV.count;
          });
        }

        Object.keys(afterDekrip).forEach((key) => {
          const keydataMan = afterDekrip[key];
          const { ...restData } = keydataMan;

          // Menambahkan data ke HourData dengan nama_kWh_Meter sebagai kunci
          finalManDataMonthly.MonthlyData = restData;
          //console.log(finalManDataDaily);
          resolve(finalManDataMonthly);
        });
      });
    } catch (err) {
      reject(err);
    }
  });
};

const finalAllDataMonthly = async () => {
  try {
    console.log("Starting data processing...");

    // Jalankan kedua fungsi secara paralel
    const [resultPLTS, resultPanel, resultManagement] = await Promise.all([
      queryPLTSperBulan(), // Query data untuk PLTS
      queryPanelperBulan(), // Query data untuk Panel
      queryDataManagementperBulan(),
    ]);

    // Log hasil data yang didapatkan
    // console.log("PLTS Data:", resultPLTS);
    // console.log("Panel Data:", resultPanel);

    // Proses data Panel (jika diperlukan)
    const processedPanelData = Object.entries(resultPanel.MonthlyData).map(
      ([meterName, meterData]) => ({
        meterName,
        ...meterData,
        processedAt: new Date().toISOString(), // Tambahkan waktu proses
      })
    );

    const processedSolarlPVData = Object.entries(resultPLTS.MonthlyData).map(
      ([meterName, meterData]) => ({
        meterName,
        ...meterData,
        processedAt: new Date().toISOString(), // Tambahkan waktu proses
      })
    );

    // Kombinasikan data dari PLTS dan Panel
    const combinedData = {
      pltsData: processedSolarlPVData,
      panelData: processedPanelData,
      PLNkwh: resultManagement,
    };

    // Log hasil akhir yang akan dikembalikan
    //console.log("Final combined data to send:", JSON.stringify(combinedData, null, 2));

    // Kembalikan data kombinasi
    return combinedData;
  } catch (error) {
    // Tangkap dan log error jika ada masalah
    console.error("Error fetching All Final data perbulan:", error);

    // Kembalikan objek kosong jika terjadi error
    return {};
  }
};

async function insertMonthlyData(data) {
  // Fungsi Insert ke log perjam
  initializeConnectionPool().then(async () => {
    async function insertDataPLTS(request, Useplts, tableName) {
      const logWaktuWIB = moment()
        .tz("Asia/Jakarta")
        .format("YYYY-MM-DD HH:mm:ss");

      // Parsing and ensuring values are formatted correctly for the table
      const parameters = {
        no_kWh_Meter: Useplts.no_kWh_Meter || null,
        nama_kWh_Meter: Useplts.meterName || null,
        v_avg: Useplts.avg_v_avg
          ? parseFloat(Useplts.avg_v_avg).toFixed(2)
          : null,
        I_avg: Useplts.avg_I_avg
          ? parseFloat(Useplts.avg_I_avg).toFixed(2)
          : null,
        log_waktu: logWaktuWIB,
        kWh_PLN: Useplts.kWh_PLN
          ? parseFloat(Useplts.kWh_PLN).toFixed(2)
          : null,
        cost_PLN: Useplts.cost_PLN
          ? parseFloat(Useplts.cost_PLN).toFixed(2)
          : null,
      };
      // console.log(`ZAZAZS`,parameters);

      // Construct SQL query
      const query = `
      INSERT INTO ${tableName} (
          no_kWh_Meter, nama_kWh_Meter, v_avg, I_avg, 
          log_waktu, kWh_PLN, cost_PLN
      )
      VALUES (
          @no_kWh_Meter, @nama_kWh_Meter, @v_avg, @I_avg,  
           CONVERT(VARCHAR, @log_waktu, 120),@kWh_PLN, CAST(@cost_PLN AS DECIMAL(18, 2))
      );
    `;

      // Bind parameters to SQL query
      for (const [key, value] of Object.entries(parameters)) {
        request.input(
          key,
          value === null
            ? sql.Null
            : typeof value === "number"
            ? sql.Float
            : sql.NVarChar,
          value
        );
      }

      // Execute the query
      try {
        await request.query(query);
        console.log(`Data successfully inserted into table: ${tableName}`);
      } catch (error) {
        console.error(`Failed to insert data into table: ${tableName}`, error);
      }
    }

    async function insertData(request, Useplts, tableName) {
      const logWaktuWIB = moment()
        .tz("Asia/Jakarta")
        .format("YYYY-MM-DD HH:mm:ss");

      // Parsing and ensuring values are formatted correctly for the table
      const parameters = {
        no_kWh_Meter: Useplts.no_kWh_Meter || null,
        nama_kWh_Meter: Useplts.meterName || null,
        v_avg: parseFloat(Useplts.avg_v_avg).toFixed(2) || null,
        I_avg: parseFloat(Useplts.avg_I_avg).toFixed(2) || null,
        PF_avg: parseFloat(Useplts.avg_PF_avg).toFixed(2) || null,
        kW: parseFloat(Useplts.total_kW).toFixed(2) || null,
        kVArh: parseFloat(Useplts.total_kVArhTotal).toFixed(2) || null,
        freq: parseFloat(Useplts.avg_freq).toFixed(2) || null,
        log_waktu: logWaktuWIB,
        total_kWh: parseFloat(Useplts.kWhPLN).toFixed(2) || null,
        costPLN: parseFloat(Useplts.costPLN).toFixed(2) || null,
      };
      //console.log(parameters);

      // Construct SQL query
      const query = `
      INSERT INTO ${tableName} (
          no_kWh_Meter, nama_kWh_Meter, v_avg, I_avg, PF_avg, kW, kVArh, freq, 
          log_waktu, kWh_PLN, cost_PLN
      )
      VALUES (
          @no_kWh_Meter, @nama_kWh_Meter, @v_avg, @I_avg, @PF_avg, @kW, @kVArh, @freq,  
           CONVERT(VARCHAR, @log_waktu, 120),@total_kWh, CAST(@costPLN AS DECIMAL(18, 2))
      );
    `;

      // Bind parameters to SQL query
      for (const [key, value] of Object.entries(parameters)) {
        request.input(
          key,
          value === null
            ? sql.Null
            : typeof value === "number"
            ? sql.Float
            : sql.NVarChar,
          value
        );
      }

      // Execute the query
      try {
        await request.query(query);
        console.log(`Data successfully inserted into table: ${tableName}`);
      } catch (error) {
        console.error(`Failed to insert data into table: ${tableName}`, error);
      }
    }

    // ============================== Insert perjam management
    async function insertDataManagementperBulan(request, Useplts) {
      const logWaktuWIB = moment()
        .tz("Asia/Jakarta")
        .format("YYYY-MM-DD HH:mm:ss");

      // Parsing and ensuring values are formatted correctly for the table
      const parameters = {
        totalPLNKWH: parseFloat(Useplts.totalPLNKWH).toFixed(2) || null,
        totalPanelKWH: parseFloat(Useplts.totalPanelKWH).toFixed(2) || null,
        totalPVKWH: parseFloat(Useplts.totalPVKWH).toFixed(2) || null,
        totalPLNCost: parseFloat(Useplts.totalPLNCost).toFixed(2) || null,
        totalPVIncome: parseFloat(Useplts.totalPVIncome).toFixed(2) || null,
        RECexpe: parseFloat(Useplts.RECexpe).toFixed(2) || null,
        EmisiPLN: parseFloat(Useplts.EmisiPLN).toFixed(2) || null,
        EEI: parseFloat(Useplts.EEI).toFixed(2) || null,
        log_waktu: logWaktuWIB,
      };

      // console.log(parameters);

      // Construct SQL query
      const query = `
      INSERT INTO tbl_Managementlog_perBulan
      VALUES (
          @totalPLNKWH, @totalPanelKWH, @totalPVKWH, @totalPLNCost, @totalPVIncome, @RECexpe, @EmisiPLN, @EEI, 
          @log_waktu
      );
      `;

      // Bind parameters to SQL query
      for (const [key, value] of Object.entries(parameters)) {
        request.input(
          key,
          value === null
            ? sql.Null
            : typeof value === "number"
            ? sql.Float
            : sql.NVarChar,
          value
        );
      }

      // Execute the query
      try {
        await request.query(query);
        console.log(
          `Data successfully inserted into table: [tbl_Managementlog_perBulan] `
        );
      } catch (error) {
        console.error(
          `Failed to insert data into table: [tbl_Managementlog_perBulan] `,
          error
        );
      }
    }

    //=============================== End

    // Main logic for insert handling data
    async function handleData(data, connectionPool) {
      const pool = await sql.connect(connectionPool);
      //console.log(`ZAZAZA`,data);

      for (const [panelName, panelData] of Object.entries(data)) {
        if (panelName === "pltsData") {
          // Insert data for each meter in pltsData
          for (const Useplts of Object.values(panelData)) {
            const tableName = `tbl_log_${Useplts.meterName.replace(
              /[-\/\s.,]/g,
              "_"
            )}_perBulan`;
            const request = pool.request(); // Create request for each insertion

            await insertDataPLTS(request, Useplts, tableName);
          }
        } else if (panelName === "panelData") {
          // Group panelData by meterName
          const groupedByMeterName = Object.values(panelData).reduce(
            (acc, UsePanel) => {
              const meterName = UsePanel.meterName.replace(/[-\/\s.,]/g, "_");
              if (!acc[meterName]) {
                acc[meterName] = [];
              }
              acc[meterName].push(UsePanel);
              return acc;
            },
            {}
          );

          // Insert data for each grouped meter in panelData
          for (const meterName of Object.keys(groupedByMeterName)) {
            const panelDataForMeter = groupedByMeterName[meterName];
            for (const UsePanel of panelDataForMeter) {
              const tableName = `tbl_log_${UsePanel.meterName.replace(
                /[-\/\s.,]/g,
                "_"
              )}_perBulan`;
              const request = pool.request(); // Create request for each insertion
              await insertData(request, UsePanel, tableName);
            }
          }
        } else if (panelName === "PLNkwh") {
          const request = pool.request(); // Create request for each insertion

          await insertDataManagementperBulan(request, panelData.MonthlyData);
        }
      }

      pool.release(); // Close the connection pool after all insertions
    }

    // Call the main function with your data and connection pool
    handleData(data, connectionPool);

    //create cache after insert
    const dataCache = await getCache("/calculationMonthly");

    if (dataCache) {
      await deleteCache("/calculationMonthly");

      await setCache("/calculationMonthly", data);
    } else {
      await setCache("/calculationMonthly", data);
    }
  });
}

// ==================================================== End

// ================================================ Start Calculate perYear
const queryPLTSperTahun = () => {
  return new Promise((resolve, reject) => {
    try {
      const afterDekrip = {};
      const logWaktuWIB = moment().tz("Asia/Jakarta").format("YYYY");

      const openConn = new sql.Request(connectionPool);
      openConn.stream = true;

      const queSolarPV = `
      SELECT 
             log_waktu, 
             v_avg, I_avg, no_kWh_Meter, nama_kWh_Meter, kWh_PLN,cost_PLN
           FROM [tbl_log_kWh_PLTS_perBulan]
           WHERE CONVERT(VARCHAR, log_waktu, 120) LIKE '${logWaktuWIB}%'
           ORDER BY log_waktu DESC     
      `;

      openConn.query(queSolarPV);

      openConn.on("row", (rest) => {
        const dekripData = { ...rest };

        ["v_avg", "I_avg", "kWh_PLN", "cost_PLN"].forEach((indexField) => {
          try {
            // dekripData[indexField] = parseFloat(
            //   atuwokzDecode(decodeBase64(decryptAES(rest[indexField])))
            // ); //------ Dekrip data blm di pakai
            dekripData[indexField] = parseFloat(rest[indexField]);
          } catch {
            dekripData[indexField] = 0; // Jika dekripsi gagal, set nilai ke 0
          }
        });

        //console.log(`HAHAHA`,dekripData);

        // destructuring OLD way
        const namaKWHMeter = rest.nama_kWh_Meter;
        const nokWhMeter = rest.no_kWh_Meter;
        const logWaktu = rest.log_waktu;

        const vAvgVal = dekripData.v_avg;
        const IAvgVal = dekripData.I_avg;

        const kWhPLN = dekripData.kWh_PLN;
        const costPLN = dekripData.cost_PLN;

        //            console.log(`HAHAH`,dekripData.nama_kWh_Meter);

        // Start & add data jika tidak ada maka default value 0
        if (!afterDekrip[rest.nama_kWh_Meter]) {
          afterDekrip[rest.nama_kWh_Meter] = {
            nama_kWh_Meter: namaKWHMeter,
            no_kWh_Meter: nokWhMeter,
            log_waktu: logWaktu, // Ambil log_waktu dari data pertama
            avg_v_avg: 0,
            avg_I_avg: 0,
            kWh_PLN: 0,
            cost_PLN: 0,
            count: 0,
          };
        }

        //rekonstruksi Data yang telah di enkripsi untuk di buat objectnya dan menghitung Total beserta rerata
        const dataSolarPV = afterDekrip[rest.nama_kWh_Meter];

        //console.log(`HAHAH`,dataSolarPV);

        dataSolarPV.avg_v_avg += vAvgVal || 0;
        dataSolarPV.avg_I_avg += IAvgVal || 0;
        dataSolarPV.kWh_PLN += kWhPLN || 0;
        dataSolarPV.cost_PLN += costPLN || 0;

        dataSolarPV.count += 1; //hitung total data yang masuk untuk pembagian rata-rata
      });

      openConn.on("done", () => {
        if (Object.keys(afterDekrip).length === 0) {
          throw new Error("No data Yearly SolarPV Recorded");
        } else {
          Object.values(afterDekrip).forEach((LastdataSolarPV) => {
            //console.log(`HAHAH`,LastdataSolarPV.avg_v_avg);
            LastdataSolarPV.avg_v_avg = parseFloat(
              LastdataSolarPV.avg_v_avg / (LastdataSolarPV.count || 1)
            ).toFixed(2);
            LastdataSolarPV.avg_I_avg = parseFloat(
              LastdataSolarPV.avg_I_avg / (LastdataSolarPV.count || 1)
            ).toFixed(2);

            // Format total kWh dan total kVArh agar memiliki 2 angka desimal
            LastdataSolarPV.kWh_PLN = parseFloat(
              LastdataSolarPV.kWh_PLN
            ).toFixed(2);

            // Menghitung biaya total (total kWh * tarif dasar)
            LastdataSolarPV.cost_PLN = parseFloat(
              LastdataSolarPV.cost_PLN
            ).toFixed(2);

            delete LastdataSolarPV.count;
          });
        }

        Object.keys(afterDekrip).forEach((key) => {
          const keySolarPVdata = afterDekrip[key];
          const { nama_kWh_Meter, ...restData } = keySolarPVdata;

          // Menambahkan data ke HourData dengan nama_kWh_Meter sebagai kunci
          finalDataToSolarPVYearly.YearlyData[nama_kWh_Meter] = restData;
          //console.log(finalDataToSolarPVDaily);
          resolve(finalDataToSolarPVYearly);
        });
      });
    } catch (err) {
      reject(err);
    }
  });
};

const queryPanelperTahun = async () => {
  //const finalDataToSendDaily = { HourData: {} }; // Inisialisasi finalDataToSend
  try {
    // Mulai pemrosesan dengan map sanitasi tabel
    await Promise.all(
      sanitizedTableNamesCache.map((tableName) =>
        retryOperation(
          () =>
            new Promise((resolve, reject) => {
              const logWaktuWIB = moment().tz("Asia/Jakarta").format("YYYY");

              const request = new sql.Request(connectionPool);
              const result = {}; // Menyimpan hasil berdasarkan nama_kWh_Meter

              request.stream = true;

              // Query untuk mendapatkan data perjam terakhir
              request.query(
                `SELECT 
             log_waktu, 
             v_avg, I_avg,kW, PF_avg, kVArh,freq,no_kWh_Meter, nama_kWh_Meter, kWh_PLN,cost_PLN
           FROM ${tableName}_perBulan
           WHERE CONVERT(VARCHAR, log_waktu, 120) LIKE '${logWaktuWIB}%'
           ORDER BY log_waktu DESC`
              );

              //     console.log(`SELECT
              //    log_waktu,
              //    v_avg, I_avg,kW, PF_avg, kVArh,freq,no_kWh_Meter, nama_kWh_Meter, kWh_PLN,cost_PLN
              //  FROM ${tableName}_perJam
              //  WHERE CONVERT(VARCHAR, log_waktu, 120) LIKE '${logWaktuWIB}%'
              //  ORDER BY log_waktu DESC`);

              // Proses data saat row datang
              request.on("row", (row) => {
                const decryptedRow = { ...row };
                // Dekripsi dan parse field numerik
                [
                  "kW",
                  "kVArh",
                  "PF_avg",
                  "v_avg",
                  "I_avg",
                  "freq",
                  "kWh_PLN",
                  "cost_PLN",
                ].forEach((field) => {
                  try {
                    // decryptedRow[field] = parseFloat(
                    //   atuwokzDecode(decodeBase64(decryptAES(row[field])))
                    // ); //blm di pakai
                    decryptedRow[field] = parseFloat(row[field]);
                  } catch {
                    decryptedRow[field] = 0; // Jika dekripsi gagal, set ke 0
                  }
                });
                //console.log(decryptedRow);

                // Extract field yang diperlukan
                const {
                  nama_kWh_Meter,
                  no_kWh_Meter,
                  log_waktu,
                  kW,
                  kVArh,
                  v_avg,
                  I_avg,
                  PF_avg,
                  freq,
                  kWh_PLN,
                  cost_PLN,
                } = decryptedRow;

                // Destructuring new WAY data meter jika belum ada
                if (!result[nama_kWh_Meter]) {
                  result[nama_kWh_Meter] = {
                    nama_kWh_Meter,
                    no_kWh_Meter,
                    log_waktu,
                    total_kVArh: 0,
                    total_kWh: 0,
                    total_kVArhTotal: 0,
                    avg_v_avg: 0,
                    avg_I_avg: 0,
                    avg_PF_avg: 0,
                    count: 0,
                    totalCost: 0,
                    avg_freq: 0,
                    kWhPLN: 0,
                    costPLN: 0,
                  };
                }

                // Update data meter
                const meterData = result[nama_kWh_Meter];
                meterData.total_kVArh += kVArh || 0;
                meterData.total_kWh += kW || 0;

                meterData.avg_v_avg += v_avg || 0;
                meterData.avg_I_avg += I_avg || 0;
                meterData.avg_PF_avg += PF_avg || 0;

                meterData.avg_freq += freq || 0;

                meterData.kWhPLN += kWh_PLN || 0;
                meterData.costPLN += cost_PLN || 0;

                meterData.count += 1;
              });

              request.on("done", () => {
                if (Object.keys(result).length === 0) {
                  reject(new Error("No data Yearly Recorded"));
                } else {
                  // Hitung rata-rata
                  Object.values(result).forEach((meterData) => {
                    meterData.avg_v_avg = parseFloat(
                      (meterData.avg_v_avg / (meterData.count || 1)).toFixed(2)
                    );
                    meterData.avg_I_avg = parseFloat(
                      (meterData.avg_I_avg / (meterData.count || 1)).toFixed(2)
                    );
                    meterData.avg_PF_avg = parseFloat(
                      (meterData.avg_PF_avg / (meterData.count || 1)).toFixed(2)
                    );

                    meterData.avg_freq = parseFloat(
                      (meterData.avg_freq / (meterData.count || 1)).toFixed(2)
                    );

                    meterData.total_kWh = parseFloat(
                      meterData.total_kWh
                    ).toFixed(2);

                    meterData.total_kVArhTotal = parseFloat(
                      meterData.total_kVArhTotal
                    ).toFixed(2);

                    meterData.kWhPLN = parseFloat(meterData.kWhPLN).toFixed(2);
                    meterData.totalCost = parseFloat(
                      meterData.totalCost
                    ).toFixed(2);

                    // delete meterData.count; // Hapus property count
                  });

                  // Tambahkan data akhir ke finalDataToSend.HourData
                  Object.keys(result).forEach((key) => {
                    const meterData = result[key];
                    const { nama_kWh_Meter, ...restData } = meterData;

                    // Tambahkan data ke HourData
                    finalDataToSendYearly.YearlyData[nama_kWh_Meter] = restData;
                  });
                  //console.log(finalDataToSendDaily);
                  resolve(finalDataToSendYearly); // Kembalikan finalDataToSend
                }
              });

              request.on("error", (err) => {
                console.error("Error during query Yearly execution:", err);
                reject(err);
              });
            })
        )
      )
    );

    return finalDataToSendYearly; // Mengembalikan finalDataToSend
  } catch (error) {
    console.error("Error during panel Monthly query:", error);
    throw error;
  }
};

const queryDataManagementperTahun = () => {
  return new Promise((resolve, reject) => {
    try {
      const afterDekrip = {};
      const logWaktuWIB = moment().tz("Asia/Jakarta").format("YYYY");

      const openConn = new sql.Request(connectionPool);
      openConn.stream = true;

      const queDataMan = `
           SELECT 
             [totalPLNKWH]
            ,[totalPanelKWH]
            ,[totalPVKWH]
            ,[totalPLNCost]
            ,[totalPVIncome]
            ,[RECexpe]
            ,[EmisiPLN]
            ,[EEI]
            ,[log_waktu]
           FROM [tbl_Managementlog_perBulan]
           WHERE CONVERT(VARCHAR, log_waktu, 120) LIKE '${logWaktuWIB}%'
           ORDER BY log_waktu DESC     
      `;

      openConn.query(queDataMan);

      openConn.on("row", (rest) => {
        const dekripData = { ...rest };

        [
          "totalPLNKWH",
          "totalPanelKWH",
          "totalPVKWH",
          "totalPLNCost",
          "totalPVIncome",
          "RECexpe",
          "EmisiPLN",
          "EEI",
        ].forEach((indexField) => {
          try {
            // dekripData[indexField] = parseFloat(
            //   atuwokzDecode(decodeBase64(decryptAES(rest[indexField])))
            // ); //------ Dekrip data blm di pakai
            dekripData[indexField] = parseFloat(rest[indexField]);
          } catch {
            dekripData[indexField] = 0; // Jika dekripsi gagal, set nilai ke 0
          }
        });

        //console.log(`HAHAHA`,dekripData);

        // destructuring OLD way
        const totalPLNKWH = dekripData.totalPLNKWH;
        const totalPanelKWH = dekripData.totalPanelKWH;
        const totalPVKWH = dekripData.totalPVKWH;
        const totalPLNCost = dekripData.totalPLNCost;
        const totalPVIncome = dekripData.totalPVIncome;
        const RECexpe = dekripData.RECexpe;
        const EmisiPLN = dekripData.EmisiPLN;
        const EEIx = dekripData.EEI;
        const logWaktu = rest.log_waktu;

        //            console.log(`HAHAH`,dekripData.nama_kWh_Meter);

        // Start & add data jika tidak ada maka default value 0
        if (!afterDekrip[rest]) {
          afterDekrip[rest] = {
            totalPLNKWH: 0,
            totalPanelKWH: 0,
            totalPVKWH: 0,
            totalPLNCost: 0,
            totalPVIncome: 0,
            RECexpe: 0,
            EmisiPLN: 0,
            EEI: 0,
            logWaktu: logWaktu,
            count: 0,
          };
        }

        //rekonstruksi Data yang telah di enkripsi untuk di buat objectnya dan menghitung Total beserta rerata
        const dataDailyMan = afterDekrip[rest];

        //console.log(`HAHAH`,dataSolarPV);

        dataDailyMan.totalPLNKWH += totalPLNKWH || 0;
        dataDailyMan.totalPanelKWH += totalPanelKWH || 0;
        dataDailyMan.totalPVKWH += totalPVKWH || 0;
        dataDailyMan.totalPLNCost += totalPLNCost || 0;
        dataDailyMan.totalPVIncome += totalPVIncome || 0;
        dataDailyMan.RECexpe += RECexpe || 0;
        dataDailyMan.EmisiPLN += EmisiPLN || 0;
        dataDailyMan.EEI += EEIx || 0;

        dataDailyMan.count += 1; //hitung total data yang masuk untuk pembagian rata-rata
      });

      openConn.on("done", () => {
        if (Object.keys(afterDekrip).length === 0) {
          throw new Error("No data Daily Management Recorded");
        } else {
          Object.values(afterDekrip).forEach((LastdataMan) => {
            //console.log(`HAHAH`,LastdataSolarPV.avg_v_avg);

            LastdataMan.totalPLNKWH = parseFloat(
              LastdataMan.totalPLNKWH
            ).toFixed(2);
            LastdataMan.totalPanelKWH = parseFloat(
              LastdataMan.totalPanelKWH
            ).toFixed(2);
            LastdataMan.totalPVKWH = parseFloat(LastdataMan.totalPVKWH).toFixed(
              2
            );
            LastdataMan.totalPLNCost = parseFloat(
              LastdataMan.totalPLNCost
            ).toFixed(2);
            LastdataMan.totalPVIncome = parseFloat(
              LastdataMan.totalPVIncome
            ).toFixed(2);
            LastdataMan.RECexpe = parseFloat(LastdataMan.RECexpe).toFixed(2);
            LastdataMan.EmisiPLN = parseFloat(LastdataMan.EmisiPLN).toFixed(2);
            LastdataMan.EEI = parseFloat(LastdataMan.EEI).toFixed(2);

            //delete LastdataSolarPV.count;
          });
        }

        Object.keys(afterDekrip).forEach((key) => {
          const keydataMan = afterDekrip[key];
          const { ...restData } = keydataMan;

          // Menambahkan data ke HourData dengan nama_kWh_Meter sebagai kunci
          finalManDataYearly.YearlyData = restData;
          //console.log(finalManDataDaily);
          resolve(finalManDataYearly);
        });
      });
    } catch (err) {
      reject(err);
    }
  });
};

const finalAllDataYearly = async () => {
  try {
    console.log("Starting data processing...");

    // Jalankan kedua fungsi secara paralel
    const [resultPLTS, resultPanel, resultManagement] = await Promise.all([
      queryPLTSperTahun(), // Query data untuk PLTS
      queryPanelperTahun(), // Query data untuk Panel
      queryDataManagementperTahun(),
    ]);

    // Log hasil data yang didapatkan
    // console.log("PLTS Data:", resultPLTS);
    // console.log("Panel Data:", resultPanel);

    // Proses data Panel (jika diperlukan)
    const processedPanelData = Object.entries(resultPanel.YearlyData).map(
      ([meterName, meterData]) => ({
        meterName,
        ...meterData,
        processedAt: new Date().toISOString(), // Tambahkan waktu proses
      })
    );

    const processedSolarlPVData = Object.entries(resultPLTS.YearlyData).map(
      ([meterName, meterData]) => ({
        meterName,
        ...meterData,
        processedAt: new Date().toISOString(), // Tambahkan waktu proses
      })
    );

    // Kombinasikan data dari PLTS dan Panel
    const combinedData = {
      pltsData: processedSolarlPVData,
      panelData: processedPanelData,
      PLNkwh: resultManagement,
    };

    // Log hasil akhir yang akan dikembalikan
    //console.log("Final combined data to send:", JSON.stringify(combinedData, null, 2));

    // Kembalikan data kombinasi
    return combinedData;
  } catch (error) {
    // Tangkap dan log error jika ada masalah
    console.error("Error fetching All Final data perTahun:", error);

    // Kembalikan objek kosong jika terjadi error
    return {};
  }
};

async function insertYearlyData(data) {
  // Fungsi Insert ke log perjam
  initializeConnectionPool().then(async () => {
    async function insertDataPLTS(request, Useplts, tableName) {
      const logWaktuWIB = moment()
        .tz("Asia/Jakarta")
        .format("YYYY-MM-DD HH:mm:ss");

      // Parsing and ensuring values are formatted correctly for the table
      const parameters = {
        no_kWh_Meter: Useplts.no_kWh_Meter || null,
        nama_kWh_Meter: Useplts.meterName || null,
        v_avg: Useplts.avg_v_avg
          ? parseFloat(Useplts.avg_v_avg).toFixed(2)
          : null,
        I_avg: Useplts.avg_I_avg
          ? parseFloat(Useplts.avg_I_avg).toFixed(2)
          : null,
        log_waktu: logWaktuWIB,
        kWh_PLN: Useplts.kWh_PLN
          ? parseFloat(Useplts.kWh_PLN).toFixed(2)
          : null,
        cost_PLN: Useplts.cost_PLN
          ? parseFloat(Useplts.cost_PLN).toFixed(2)
          : null,
      };
      // console.log(`ZAZAZS`,parameters);

      // Construct SQL query
      const query = `
      INSERT INTO ${tableName} (
          no_kWh_Meter, nama_kWh_Meter, v_avg, I_avg, 
          log_waktu, kWh_PLN, cost_PLN
      )
      VALUES (
          @no_kWh_Meter, @nama_kWh_Meter, @v_avg, @I_avg,  
           CONVERT(VARCHAR, @log_waktu, 120),@kWh_PLN, CAST(@cost_PLN AS DECIMAL(18, 2))
      );
    `;

      // Bind parameters to SQL query
      for (const [key, value] of Object.entries(parameters)) {
        request.input(
          key,
          value === null
            ? sql.Null
            : typeof value === "number"
            ? sql.Float
            : sql.NVarChar,
          value
        );
      }

      // Execute the query
      try {
        await request.query(query);
        console.log(`Data successfully inserted into table: ${tableName}`);
      } catch (error) {
        console.error(`Failed to insert data into table: ${tableName}`, error);
      }
    }

    async function insertData(request, Useplts, tableName) {
      const logWaktuWIB = moment()
        .tz("Asia/Jakarta")
        .format("YYYY-MM-DD HH:mm:ss");

      // Parsing and ensuring values are formatted correctly for the table
      const parameters = {
        no_kWh_Meter: Useplts.no_kWh_Meter || null,
        nama_kWh_Meter: Useplts.meterName || null,
        v_avg: parseFloat(Useplts.avg_v_avg).toFixed(2) || null,
        I_avg: parseFloat(Useplts.avg_I_avg).toFixed(2) || null,
        PF_avg: parseFloat(Useplts.avg_PF_avg).toFixed(2) || null,
        kW: parseFloat(Useplts.total_kW).toFixed(2) || null,
        kVArh: parseFloat(Useplts.total_kVArhTotal).toFixed(2) || null,
        freq: parseFloat(Useplts.avg_freq).toFixed(2) || null,
        log_waktu: logWaktuWIB,
        total_kWh: parseFloat(Useplts.kWhPLN).toFixed(2) || null,
        costPLN: parseFloat(Useplts.costPLN).toFixed(2) || null,
      };
      //console.log(parameters);

      // Construct SQL query
      const query = `
      INSERT INTO ${tableName} (
          no_kWh_Meter, nama_kWh_Meter, v_avg, I_avg, PF_avg, kW, kVArh, freq, 
          log_waktu, kWh_PLN, cost_PLN
      )
      VALUES (
          @no_kWh_Meter, @nama_kWh_Meter, @v_avg, @I_avg, @PF_avg, @kW, @kVArh, @freq,  
           CONVERT(VARCHAR, @log_waktu, 120),@total_kWh, CAST(@costPLN AS DECIMAL(18, 2))
      );
    `;

      // Bind parameters to SQL query
      for (const [key, value] of Object.entries(parameters)) {
        request.input(
          key,
          value === null
            ? sql.Null
            : typeof value === "number"
            ? sql.Float
            : sql.NVarChar,
          value
        );
      }

      // Execute the query
      try {
        await request.query(query);
        console.log(`Data successfully inserted into table: ${tableName}`);
      } catch (error) {
        console.error(`Failed to insert data into table: ${tableName}`, error);
      }
    }

    // ============================== Insert perjam management
    async function insertDataManagementperTahun(request, Useplts) {
      const logWaktuWIB = moment()
        .tz("Asia/Jakarta")
        .format("YYYY-MM-DD HH:mm:ss");

      // Parsing and ensuring values are formatted correctly for the table
      const parameters = {
        totalPLNKWH: parseFloat(Useplts.totalPLNKWH).toFixed(2) || null,
        totalPanelKWH: parseFloat(Useplts.totalPanelKWH).toFixed(2) || null,
        totalPVKWH: parseFloat(Useplts.totalPVKWH).toFixed(2) || null,
        totalPLNCost: parseFloat(Useplts.totalPLNCost).toFixed(2) || null,
        totalPVIncome: parseFloat(Useplts.totalPVIncome).toFixed(2) || null,
        RECexpe: parseFloat(Useplts.RECexpe).toFixed(2) || null,
        EmisiPLN: parseFloat(Useplts.EmisiPLN).toFixed(2) || null,
        EEI: parseFloat(Useplts.EEI).toFixed(2) || null,
        log_waktu: logWaktuWIB,
      };

      // console.log(parameters);

      // Construct SQL query
      const query = `
      INSERT INTO tbl_Managementlog_perTahun
      VALUES (
          @totalPLNKWH, @totalPanelKWH, @totalPVKWH, @totalPLNCost, @totalPVIncome, @RECexpe, @EmisiPLN, @EEI, 
          @log_waktu
      );
      `;

      // Bind parameters to SQL query
      for (const [key, value] of Object.entries(parameters)) {
        request.input(
          key,
          value === null
            ? sql.Null
            : typeof value === "number"
            ? sql.Float
            : sql.NVarChar,
          value
        );
      }

      // Execute the query
      try {
        await request.query(query);
        console.log(
          `Data successfully inserted into table: [tbl_Managementlog_perTahun] `
        );
      } catch (error) {
        console.error(
          `Failed to insert data into table: [tbl_Managementlog_perTahun] `,
          error
        );
      }
    }

    //=============================== End

    // Main logic for insert handling data
    async function handleData(data, connectionPool) {
      const pool = await sql.connect(connectionPool);
      //console.log(`ZAZAZA`,data);

      for (const [panelName, panelData] of Object.entries(data)) {
        if (panelName === "pltsData") {
          // Insert data for each meter in pltsData
          for (const Useplts of Object.values(panelData)) {
            const tableName = `tbl_log_${Useplts.meterName.replace(
              /[-\/\s.,]/g,
              "_"
            )}_perTahun`;
            const request = pool.request(); // Create request for each insertion

            await insertDataPLTS(request, Useplts, tableName);
          }
        } else if (panelName === "panelData") {
          // Group panelData by meterName
          const groupedByMeterName = Object.values(panelData).reduce(
            (acc, UsePanel) => {
              const meterName = UsePanel.meterName.replace(/[-\/\s.,]/g, "_");
              if (!acc[meterName]) {
                acc[meterName] = [];
              }
              acc[meterName].push(UsePanel);
              return acc;
            },
            {}
          );

          // Insert data for each grouped meter in panelData
          for (const meterName of Object.keys(groupedByMeterName)) {
            const panelDataForMeter = groupedByMeterName[meterName];
            for (const UsePanel of panelDataForMeter) {
              const tableName = `tbl_log_${UsePanel.meterName.replace(
                /[-\/\s.,]/g,
                "_"
              )}_perTahun`;
              const request = pool.request(); // Create request for each insertion
              await insertData(request, UsePanel, tableName);
            }
          }
        } else if (panelName === "PLNkwh") {
          const request = pool.request(); // Create request for each insertion

          await insertDataManagementperTahun(request, panelData.YearlyData);
        }
      }

      pool.release(); // Close the connection pool after all insertions
    }

    // Call the main function with your data and connection pool
    handleData(data, connectionPool);

    //create cache after insert
    const dataCache = await getCache("/calculationYearly");

    if (dataCache) {
      await deleteCache("/calculationYearly");

      await setCache("/calculationYearly", data);
    } else {
      await setCache("/calculationYearly", data);
    }
  });
}

// ==================================================== End

// ================================================ Start View Dashboard

const DashboardManagement = async () => {

  const tampilDataAktualDailyKWH = { DailyAktualKWH: {} },
        tampilDataAktualMonthlyKWH = { MonthlyAktualKWH: {} };
  
// =================== Untuk Card         
  const tampilDataAktualHourlySolarPV = { HourlyAktualSolarPV: [] },
        tampilDataAktualDailySolarPV = { DailyAktualSolarPV: [] },
        tampilDataAktualMonthlySolarPV = { MonthlyAktualSolarPV: [] };

  const tampilDataAktualHourlyManagement = {HourlyData:[]},
        tampilDataAktualDailyManagement = {DailyData:[]},
        tampilDataAktualMonthlyManagement = {MonthlyData:[]};

  const tampilDatPlanDailyEmisi = {},
        tampilDataPlanlMonthlyEmisi = {};

// ==================== Untuk Plan

const   tampilDataPlanDailyKWH = { DailyPlanKWH: [] },
        tampilDataPlanMonthlyKWH = { MonthlyPlanKWH:[] };

// ===================== Untuk tabel
  const tampilDataTabelDailySolarPV = { DailyTabelSolarPV: [] },
        tampilDataTabelMonthlySolarPV = { MonthlyTabelSolarPV: [] },
        tampilDataTabelYearlySolarPV = { YearlyTabelSolarPV: [] };

  const tampilDataTabelHourly = { HourlyTabel: [] },
        tampilDataTabelDaily = { DailyTabel: [] },
        tampilDataTabelMonthly = { MonthlyTabel: [] },
        tampilDataTabelYearly = { YearlyTabel: [] };
  
  const getFisicalYear = async () => {
    return new Promise((resolve, reject) => {
      try {
        const requestFisicalYear = new sql.Request(connectionPool);
        requestFisicalYear.stream = true;

        let isFirstRowProcessed = false; // Variabel untuk memastikan hanya 1 baris yang diproses
        let fisicalYear = null; // Menyimpan nilai fiscal year yang akan dikembalikan --DESC
        // Jalankan query
        requestFisicalYear.query(`
            SELECT TOP(1) fisical_Year FROM tbl_Fisical_year ORDER BY fisical_year ASC; 
          `);

        // Tangani event `row`
        requestFisicalYear.on("row", (row) => {
          // console.log(`HAHAHA`);

          if (!isFirstRowProcessed) {
            const datax = {};
            ["fisical_Year"].forEach((field) => {
              datax[field] = row[field];
            });

            // console.log(datax); // Log data baris pertama
            fisicalYear = datax.fisical_Year; // Simpan fiscal year

            isFirstRowProcessed = true; // Tandai baris pertama sudah diproses
          }
        });

        // Tangani event `done` untuk memastikan query selesai
        requestFisicalYear.on("done", () => {
          if (fisicalYear) {
            resolve(fisicalYear); // Kembalikan nilai fisical_Year setelah selesai
          } else {
            reject("Tidak ada data fiscal year yang ditemukan"); // Jika tidak ada data
          }
        });

        // Tangani event `error` jika terjadi kesalahan saat query
        requestFisicalYear.on("error", (err) => {
          console.error("Error during query execution:", err);
          reject(err); // Kembalikan error jika terjadi masalah dengan query
        });
      } catch (err) {
        console.error("Error during request initialization:", err);
        reject(err); // Tangani error jika terjadi kesalahan pada bagian awal
      }
    });
  };

  const fisicalYear = await getFisicalYear();
  // console.log(`hahah`,fisicalYear);

  function getFiscalYearRange(fiscalYear) {
    // console.log(`hahah`,fiscalYear);

    const years = fiscalYear.split("-"); // Pecah string fiscal year seperti 2025-2026
    const startYear = parseInt(years[0]); // Tahun mulai (2025)
    const endYear = parseInt(years[1]); // Tahun akhir (2026)

    const startDate = `${startYear}-03-01`; // 1 Maret tahun mulai
    const endDate = `${endYear}-04-30`; // 30 April tahun akhir

    return { startDate, endDate };
  }


  const tampilDailyKWHPLN = async () => {
    try {
      await Promise.all(
        sanitizedTableNamesCache.map((tableName) =>
          retryOperation(
            () =>
              new Promise((resolve, reject) => {
                const logWaktuWIB = moment()
                  .tz("Asia/Jakarta")
                  .format("YYYY-MM-DD");

                const requestDailyKWH = new sql.Request(connectionPool);
                const resultDailyKWH = {}; // Menyimpan hasil berdasarkan nama_kWh_Meter

                // Mendapatkan tanggal Senin dan Minggu dari tanggal sekarang
                const today = new Date();
                const dayOfWeek = today.getDay(); // 0 = Minggu, 1 = Senin, ..., 6 = Sabtu
                const monday = new Date(today);
                monday.setDate(today.getDate() - dayOfWeek + 1); // Set tanggal ke Senin
                const sunday = new Date(monday);
                sunday.setDate(monday.getDate() + 6); // Set tanggal ke Minggu

                // Format tanggal ke 'YYYY-MM-DD'
                const mondayStr = monday.toISOString().split("T")[0];
                const sundayStr = sunday.toISOString().split("T")[0];

                //console.log(mondayStr,sundayStr);
                requestDailyKWH.stream = true;

                // Query untuk mendapatkan data perjam terakhir
                requestDailyKWH.query(
                  `SELECT 
                  log_waktu, no_kWh_Meter, nama_kWh_Meter, kWh_PLN,cost_PLN
                  FROM ${tableName}_perHari
                  WHERE CONVERT(VARCHAR, log_waktu, 120) >= '${mondayStr}' AND CONVERT(VARCHAR, log_waktu, 120) <= '${sundayStr}%'
                  ORDER BY log_waktu DESC`
                );

                // Proses data saat row datang
                requestDailyKWH.on("row", (row) => {
                  const decryptedRow = { ...row };
                  // Dekripsi dan parse field numerik
                  ["kWh_PLN", "cost_PLN"].forEach((field) => {
                    try {
                      // decryptedRow[field] = parseFloat(
                      //   atuwokzDecode(decodeBase64(decryptAES(row[field])))
                      // ); //blm di pakai
                      decryptedRow[field] = parseFloat(row[field]);
                    } catch {
                      decryptedRow[field] = 0; // Jika dekripsi gagal, set ke 0
                    }
                  });
                  //console.log(decryptedRow);

                  // Extract field yang diperlukan
                  const {
                    nama_kWh_Meter,
                    no_kWh_Meter,
                    log_waktu,
                    kWh_PLN,
                    cost_PLN,
                  } = decryptedRow;

                  // Destructuring new WAY data meter jika belum ada
                  if (!resultDailyKWH[nama_kWh_Meter]) {
                    resultDailyKWH[nama_kWh_Meter] = {
                      nama_kWh_Meter,
                      no_kWh_Meter,
                      log_waktu,
                      kWhPLN: 0,
                      costPLN: 0,
                      count: 0,
                    };
                  }

                  // console.log(`HAHAH`, resultDailyKWH[nama_kWh_Meter]);
                  // Update data meter
                  const meterData = resultDailyKWH[nama_kWh_Meter];

                  meterData.kWhPLN = kWh_PLN || 0;
                  meterData.costPLN = cost_PLN || 0;

                  meterData.count += 1;
                });

                requestDailyKWH.on("done", () => {
                  Object.keys(resultDailyKWH).forEach((key) => {
                    const meterData = resultDailyKWH[key];
                    const { nama_kWh_Meter, ...restData } = meterData;

                    // Tambahkan data ke HourData
                    tampilDataAktualDailyKWH.DailyAktualKWH[nama_kWh_Meter] =
                      restData;
                    //console.log(tampilDataAktualDailyKWH);
                    resolve(tampilDataAktualDailyKWH);
                  });
                });

                requestDailyKWH.on("error", (err) => {
                  console.error("Error during query Daily KWH execution:", err);
                  reject(err);
                });
              })
          )
        )
      );

      return tampilDataAktualDailyKWH; // Mengembalikan finalDataToSend
    } catch (err) {
      console.log(`Error Tampil Data KWH`);
    }
  }; //punya tampil Daily kwh

  const tampilMonthlyKWHPLN = async () => {
    try {
      await Promise.all(
        sanitizedTableNamesCache.map((tableName) =>
          retryOperation(
            () =>
              new Promise((resolve, reject) => {
                const { startDate, endDate } = getFiscalYearRange(fisicalYear);

                // const logWaktuWIB = moment()
                //   .tz("Asia/Jakarta")
                //   .format("YYYY-MM-DD");

                const requestMontlyKWH = new sql.Request(connectionPool);
                const resultMonthlyKWH = {}; // Menyimpan hasil berdasarkan nama_kWh_Meter

                //console.log(mondayStr,sundayStr);
                requestMontlyKWH.stream = true;

                // Query untuk mendapatkan data perjam terakhir
                requestMontlyKWH.query(
                  `SELECT 
                  log_waktu, no_kWh_Meter, nama_kWh_Meter, kWh_PLN,cost_PLN
                  FROM ${tableName}_perBulan
                  WHERE CONVERT(VARCHAR, log_waktu, 120) >= '${startDate}' AND CONVERT(VARCHAR, log_waktu, 120) <= '${endDate}%'
                  ORDER BY log_waktu ASC`
                );

                // Proses data saat row datang
                requestMontlyKWH.on("row", (row) => {
                  const decryptedRow = { ...row };
                  // Dekripsi dan parse field numerik
                  ["kWh_PLN", "cost_PLN"].forEach((field) => {
                    try {
                      // decryptedRow[field] = parseFloat(
                      //   atuwokzDecode(decodeBase64(decryptAES(row[field])))
                      // ); //blm di pakai
                      decryptedRow[field] = parseFloat(row[field]);
                    } catch {
                      decryptedRow[field] = 0; // Jika dekripsi gagal, set ke 0
                    }
                  });
                  //console.log(decryptedRow);

                  // Extract field yang diperlukan
                  const {
                    nama_kWh_Meter,
                    no_kWh_Meter,
                    log_waktu,
                    kWh_PLN,
                    cost_PLN,
                  } = decryptedRow;

                  // Destructuring new WAY data meter jika belum ada
                  if (!resultMonthlyKWH[nama_kWh_Meter]) {
                    resultMonthlyKWH[nama_kWh_Meter] = {
                      nama_kWh_Meter,
                      no_kWh_Meter,
                      log_waktu,
                      kWhPLN: 0,
                      costPLN: 0,
                      count: 0,
                    };
                  }

                  // console.log(`HAHAH`, resultDailyKWH[nama_kWh_Meter]);
                  // Update data meter
                  const meterData = resultMonthlyKWH[nama_kWh_Meter];

                  meterData.kWhPLN = kWh_PLN || 0;
                  meterData.costPLN = cost_PLN || 0;

                  meterData.count += 1;
                });

                requestMontlyKWH.on("done", () => {
                  Object.keys(resultMonthlyKWH).forEach((key) => {
                    const meterData = resultMonthlyKWH[key];
                    const { nama_kWh_Meter, ...restData } = meterData;

                    // Tambahkan data ke HourData
                    tampilDataAktualMonthlyKWH.MonthlyAktualKWH[
                      nama_kWh_Meter
                    ] = restData;
                    //console.log(tampilDataAktualMonthlyKWH);
                    resolve(tampilDataAktualMonthlyKWH);
                  });
                });

                requestMontlyKWH.on("error", (err) => {
                  console.error("Error during query Daily KWH execution:", err);
                  reject(err);
                });
              })
          )
        )
      );

      return tampilDataAktualMonthlyKWH; // Mengembalikan finalDataToSend
    } catch (err) {
      console.log(`Error Tampil Data KWH`);
    }
  }; //punya tampil Monthly kwh

  const tampilDailyPlanKWHPLN = async () => {
    try {
     
      await new Promise((resolve, reject) => {
        const request = new sql.Request(connectionPool);

        let resultDailyPlan = {};

        // get minggu hari senin - minggu
        // Mendapatkan tanggal Senin dan Minggu dari tanggal sekarang
        const today = new Date();
        const dayOfWeek = today.getDay(); // 0 = Minggu, 1 = Senin, ..., 6 = Sabtu
        const monday = new Date(today);
        monday.setDate(today.getDate() - dayOfWeek + 1); // Set tanggal ke Senin
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6); // Set tanggal ke Minggu

        // Format tanggal ke 'YYYY-MM-DD'
        const date_start = monday.toISOString().split("T")[0];
        const date_end = sunday.toISOString().split("T")[0];

        // console.log(date_start,date_end);

        const query = `
        SELECT fiscal_year,[date],daily_cost,daily_kwh 
        FROM [senkutoyota].[dbo].[tbl_cost_daily_plan]
        WHERE CONVERT(VARCHAR, [date], 120) >= '${date_start}' and CONVERT(VARCHAR, [date], 120) <= '${date_end}'
        ORDER BY date ASC
        `;
        request.stream = true;

        request.query(query);

        
        request.on("row", (row) => {
          const dataTemp = {};
          Object.keys(row).forEach((field) => {
            dataTemp[field] = row[field];
          });

          const {
            fiscal_year,
            date, // Tanggal akan dikonversi jika perlu
            daily_cost,
            daily_kwh,
          } = dataTemp;

          //const formattedDate = date ? new Date(date) : null;  // Mengonversi string ke objek Date

          // Membuat objek baru untuk menyimpan data yang diperlukan
          resultDailyPlan = {
            fiscal_year,
            date,
            daily_cost,
            daily_kwh,
          };

          // Tambahkan data ke array DailyPlanKWH
          tampilDataPlanDailyKWH.DailyPlanKWH.push(resultDailyPlan);
        });
          //const kwhPlan = resultDailyPlan;
          //console.log(resultDailyPlan);

        request.on("done", () => {
          //console.log(tampilDataPlanDailyKWH);
        
          // Selesaikan promise dengan data lengkap
          resolve(tampilDataPlanDailyKWH);
        });
      
      });
      return tampilDataPlanDailyKWH;
    } catch (err) {}
  };

  const tampilMonthlyPlanKWHPLN = async () => {
    try {
      await new Promise((resolve, reject) => {
        //const {startDate,endDate} = getFiscalYearRange(fisicalYear);
  
        // const logWaktuWIB = moment()
        //   .tz("Asia/Jakarta")
        //   .format("YYYY-MM-DD");
        let resultMontlyPlan = [];
        const requestMontlyCost = new sql.Request(connectionPool);
        const resultMonthlyCost = {}; // Menyimpan hasil berdasarkan nama_kWh_Meter
  
        //console.log(mondayStr,sundayStr);
        requestMontlyCost.stream = true;
  
        // console.log(date_start,date_end);
  
        const query = `
        SELECT [fiscal_year],[month],[total_cost],[total_kwh] 
        FROM [senkutoyota].[dbo].[tbl_cost_monthly_plan]
        WHERE fiscal_year = '${fisicalYear}'
        ORDER BY fiscal_year ASC
      `;
  
        requestMontlyCost.stream = true;
  
        requestMontlyCost.query(query);
  
        //const resultDailyPlan = {};
  
        requestMontlyCost.on("row", (row) => {
          const dataTemp = {};
          Object.keys(row).forEach((field) => {
            dataTemp[field] = row[field];
          });
  
          const {
            fiscal_year,
            month, // Tanggal akan dikonversi jika perlu
            total_cost,
            total_kwh,
          } = dataTemp;
  
          const bulanArray = [
            "Januari",
            "Februari",
            "Maret",
            "April",
            "Mei",
            "Juni",
            "Juli",
            "Agustus",
            "September",
            "Oktober",
            "November",
            "Desember",
          ];
          //const formattedDate = date ? new Date(date) : null;  // Mengonversi string ke objek Date
  
          // Membuat objek baru untuk menyimpan data yang diperlukan
          resultMontlyPlan = {
            fiscal_year,
            month: bulanArray[dataTemp.month - 1],
            total_cost,
            total_kwh,
          };

          tampilDataPlanMonthlyKWH.MonthlyPlanKWH.push(resultMontlyPlan);
        });
          //const kwhPlan = resultDailyPlan;
          //console.log(resultMontlyPlan);
  
        requestMontlyCost.on("done", () => {
            //tampilDataPlanMonthlyKWH.DailyPlanKWH = resultMontlyPlan;
            //console.log(tampilDataPlanMonthlyKWH);
            resolve(tampilDataPlanMonthlyKWH);
        });
      
      });
      return tampilDataPlanMonthlyKWH;
    }
    catch (err){
      
    }
    
  };



  const tampildailyTabelManagement = async () => {
    try {
     
      await new Promise((resolve, reject) => {
        const logWaktuWIB = moment()
        .tz("Asia/Jakarta")
        .format("YYYY-MM-DD");

        const request = new sql.Request(connectionPool);

        let resultDailyPlan = [];

        // console.log(date_start,date_end);

        const query = `
        SELECT [totalPLNKWH]
          ,[totalPanelKWH]
          ,[totalPVKWH]
          ,[totalPLNCost]
          ,[totalPVIncome]
          ,[RECexpe]
          ,[EmisiPLN]
          ,[EEI]
          ,[log_waktu]
        FROM [senkutoyota].[dbo].[tbl_Managementlog_perHari]
        WHERE CONVERT(VARCHAR, [log_waktu], 120) like '${logWaktuWIB}%'
        ORDER BY log_waktu ASC
        `;
        request.stream = true;

        request.query(query);

        
        request.on("row", (row) => {
          const dataTemp = {};
          Object.keys(row).forEach((field) => {
            dataTemp[field] = row[field];
          });

          const {
            totalPLNKWH,
            totalPanelKWH, // Tanggal akan dikonversi jika perlu
            totalPLNCost,
            totalPVIncome,
            RECexpe,
            EmisiPLN,
            EEI,
            log_waktu
          } = dataTemp;

          //const formattedDate = date ? new Date(date) : null;  // Mengonversi string ke objek Date

          // Membuat objek baru untuk menyimpan data yang diperlukan
          resultDailyPlan = {
            totalPLNKWH,
            totalPanelKWH, // Tanggal akan dikonversi jika perlu
            totalPLNCost,
            totalPVIncome,
            RECexpe,
            EmisiPLN,
            EEI,
            log_waktu
          };

          // Tambahkan data ke array DailyPlanKWH
          tampilDataTabelDaily.DailyTabel.push(resultDailyPlan);

        });
          //const kwhPlan = resultDailyPlan;
          //console.log(resultDailyPlan);

        request.on("done", () => {
          //console.log(tampilDataPlanDailyKWH);
        
          // Selesaikan promise dengan data lengkap
          resolve(tampilDataTabelDaily);
        });
      
      });
      return tampilDataTabelDaily;
    } catch (err) {}
  };

  const tampilmonthlyTabelManagement = async () => {
    try {
     
      await new Promise((resolve, reject) => {
        const request = new sql.Request(connectionPool);

        let resultMonthlyPlan = [];

       const logWaktuWIB = moment()
          .tz("Asia/Jakarta")
          .format("YYYY-MM");
      
        const query = `
        SELECT [totalPLNKWH]
          ,[totalPanelKWH]
          ,[totalPVKWH]
          ,[totalPLNCost]
          ,[totalPVIncome]
          ,[RECexpe]
          ,[EmisiPLN]
          ,[EEI]
          ,[log_waktu]
        FROM [senkutoyota].[dbo].[tbl_Managementlog_perBulan]
        WHERE CONVERT(VARCHAR, [log_waktu], 120) like '${logWaktuWIB}%'
        ORDER BY log_waktu ASC
        `;
        request.stream = true;

        request.query(query);

        
        request.on("row", (row) => {
          const dataTemp = {};
          Object.keys(row).forEach((field) => {
            dataTemp[field] = row[field];
          });

          const {
            totalPLNKWH,
            totalPanelKWH, // Tanggal akan dikonversi jika perlu
            totalPLNCost,
            totalPVIncome,
            RECexpe,
            EmisiPLN,
            EEI,
            log_waktu
          } = dataTemp;

          //const formattedDate = date ? new Date(date) : null;  // Mengonversi string ke objek Date

          // Membuat objek baru untuk menyimpan data yang diperlukan
          resultMonthlyPlan = {
            totalPLNKWH,
            totalPanelKWH, // Tanggal akan dikonversi jika perlu
            totalPLNCost,
            totalPVIncome,
            RECexpe,
            EmisiPLN,
            EEI,
            log_waktu
          };

          // Tambahkan data ke array DailyPlanKWH
          tampilDataTabelMonthly.MonthlyTabel.push(resultMonthlyPlan);

        });
          //const kwhPlan = resultDailyPlan;
          //console.log(resultDailyPlan);

        request.on("done", () => {
          //console.log(tampilDataPlanDailyKWH);
        
          // Selesaikan promise dengan data lengkap
          resolve(tampilDataTabelMonthly);
        });
      
      });
      return tampilDataTabelMonthly;
    } catch (err) {}
  };

  const tampilyearlyTabelManagement = async () => {
    try {
     
      await new Promise((resolve, reject) => {
        const request = new sql.Request(connectionPool);

        let resultYearlyPlan = [];

       const logWaktuWIB = moment()
          .tz("Asia/Jakarta")
          .format("YYYY");
      
        const query = `
        SELECT [totalPLNKWH]
          ,[totalPanelKWH]
          ,[totalPVKWH]
          ,[totalPLNCost]
          ,[totalPVIncome]
          ,[RECexpe]
          ,[EmisiPLN]
          ,[EEI]
          ,[log_waktu]
        FROM [senkutoyota].[dbo].[tbl_Managementlog_perTahun]
        WHERE CONVERT(VARCHAR, [log_waktu], 120) like '${logWaktuWIB}%'
        ORDER BY log_waktu ASC
        `;
        request.stream = true;

        request.query(query);

        
        request.on("row", (row) => {
          const dataTemp = {};
          Object.keys(row).forEach((field) => {
            dataTemp[field] = row[field];
          });

          const {
            totalPLNKWH,
            totalPanelKWH, // Tanggal akan dikonversi jika perlu
            totalPLNCost,
            totalPVIncome,
            RECexpe,
            EmisiPLN,
            EEI,
            log_waktu
          } = dataTemp;

          //const formattedDate = date ? new Date(date) : null;  // Mengonversi string ke objek Date

          // Membuat objek baru untuk menyimpan data yang diperlukan
          resultYearlyPlan = {
            totalPLNKWH,
            totalPanelKWH, // Tanggal akan dikonversi jika perlu
            totalPLNCost,
            totalPVIncome,
            RECexpe,
            EmisiPLN,
            EEI,
            log_waktu
          };

          // Tambahkan data ke array DailyPlanKWH
          tampilDataTabelYearly.YearlyTabel.push(resultYearlyPlan);

        });
          //const kwhPlan = resultDailyPlan;
          //console.log(resultDailyPlan);

        request.on("done", () => {
          //console.log(tampilDataPlanDailyKWH);
        
          // Selesaikan promise dengan data lengkap
          resolve(tampilDataTabelYearly);
        });
      
      });
      return tampilDataTabelYearly;
    } catch (err) {}
  };

  const tampilsolarPVHourly = async () => {
    try {
      await new Promise((resolve, reject) => {
                const logWaktuWIB = moment()
                  .tz("Asia/Jakarta")
                  .format("YYYY-MM-DD");

                const requestDailyKWH = new sql.Request(connectionPool);
                let resultDailyKWH = []; // Menyimpan hasil berdasarkan nama_kWh_Meter

                const todayStart = moment().startOf('day').format('YYYY-MM-DD HH:mm:ss'); // Jam 00:00
                const todayEnd = moment().endOf('day').format('YYYY-MM-DD HH:mm:ss'); // Jam 23:59:59.999

                //console.log(todayStart,todayEnd);
                requestDailyKWH.stream = true;

                // Query untuk mendapatkan data perjam terakhir
                requestDailyKWH.query(
                  `SELECT 
                  log_waktu, no_kWh_Meter, nama_kWh_Meter, kWh_PLN,cost_PLN
                  FROM tbl_log_kWh_PLTS_perJam
                  WHERE log_waktu >= '${todayStart}' AND log_waktu <= '${todayEnd}'
                  ORDER BY log_waktu ASC`
                );

                // Proses data saat row datang
                requestDailyKWH.on("row", (row) => {
                  const decryptedRow = { ...row };
                  // Dekripsi dan parse field numerik
                  ["kWh_PLN", "cost_PLN"].forEach((field) => {
                    try {
                      // decryptedRow[field] = parseFloat(
                      //   atuwokzDecode(decodeBase64(decryptAES(row[field])))
                      // ); //blm di pakai
                      decryptedRow[field] = parseFloat(row[field]);
                    } catch {
                      decryptedRow[field] = 0; // Jika dekripsi gagal, set ke 0
                    }
                  });
                  //console.log(decryptedRow);

                  // Extract field yang diperlukan
                  const {
                    nama_kWh_Meter,
                    no_kWh_Meter,
                    log_waktu,
                    kWh_PLN,
                    cost_PLN,
                  } = decryptedRow;

                  // Destructuring new WAY data meter jika belum ada
                
                    resultDailyKWH[nama_kWh_Meter] = {
                      nama_kWh_Meter,
                      no_kWh_Meter,
                      log_waktu,
                      PVProd:kWh_PLN ,
                      cost_PLN,
                    };
                  

                   //console.log(`HAHAH`, resultDailyKWH[nama_kWh_Meter]);
                  // Update data meter
                  //let meterData = resultDailyKWH[nama_kWh_Meter]; tampilDataAktualHourlySolarPV = { HourlyAktualSolarPV: [] }

                  tampilDataAktualHourlySolarPV.HourlyAktualSolarPV.push(resultDailyKWH[nama_kWh_Meter]);
                });

                requestDailyKWH.on("done", () => {
                  
                    resolve(tampilDataAktualHourlySolarPV);
                  
                });

                requestDailyKWH.on("error", (err) => {
                  console.error("Error during query Daily KWH execution:", err);
                  reject(err);
                });
              })
      return tampilDataAktualHourlySolarPV; // Mengembalikan finalDataToSend
    } catch (err) {
      console.log(`Error Tampil Data KWH`);
    }

  };

  const tampilsolarPVDaily = async () => {
    try {
      await new Promise((resolve, reject) => {
                const logWaktuWIB = moment()
                  .tz("Asia/Jakarta")
                  .format("YYYY-MM-DD");

                const requestDailyKWH = new sql.Request(connectionPool);
                let resultDailyKWH = []; // Menyimpan hasil berdasarkan nama_kWh_Meter

                // Mendapatkan tanggal Senin dan Minggu dari tanggal sekarang
                const today = new Date();
                const dayOfWeek = today.getDay(); // 0 = Minggu, 1 = Senin, ..., 6 = Sabtu
                const monday = new Date(today);
                monday.setDate(today.getDate() - dayOfWeek + 1); // Set tanggal ke Senin
                const sunday = new Date(monday);
                sunday.setDate(monday.getDate() + 6); // Set tanggal ke Minggu

                // Format tanggal ke 'YYYY-MM-DD'
                const mondayStr = monday.toISOString().split("T")[0];
                const sundayStr = sunday.toISOString().split("T")[0];

                //console.log(mondayStr,sundayStr);
                requestDailyKWH.stream = true;

                // Query untuk mendapatkan data perjam terakhir
                requestDailyKWH.query(
                  `SELECT 
                  log_waktu, no_kWh_Meter, nama_kWh_Meter, kWh_PLN,cost_PLN
                  FROM tbl_log_kWh_PLTS_perHari
                  WHERE log_waktu >= '${mondayStr}' AND log_waktu <= '${sundayStr}'
                  ORDER BY log_waktu ASC`
                );

                // Proses data saat row datang
                requestDailyKWH.on("row", (row) => {
                  const decryptedRow = { ...row };
                  // Dekripsi dan parse field numerik
                  ["kWh_PLN", "cost_PLN"].forEach((field) => {
                    try {
                      // decryptedRow[field] = parseFloat(
                      //   atuwokzDecode(decodeBase64(decryptAES(row[field])))
                      // ); //blm di pakai
                      decryptedRow[field] = parseFloat(row[field]);
                    } catch {
                      decryptedRow[field] = 0; // Jika dekripsi gagal, set ke 0
                    }
                  });
                  //console.log(decryptedRow);

                  // Extract field yang diperlukan
                  const {
                    nama_kWh_Meter,
                    no_kWh_Meter,
                    log_waktu,
                    kWh_PLN,
                    cost_PLN,
                  } = decryptedRow;

                  // Destructuring new WAY data meter jika belum ada
                
                    resultDailyKWH[nama_kWh_Meter] = {
                      nama_kWh_Meter,
                      no_kWh_Meter,
                      log_waktu,
                      PVProd:kWh_PLN ,
                      cost_PLN,
                    };
                  

                   //console.log(`HAHAH`, resultDailyKWH[nama_kWh_Meter]);
                  // Update data meter
                  //let meterData = resultDailyKWH[nama_kWh_Meter];

                  tampilDataAktualDailySolarPV.DailyAktualSolarPV.push(resultDailyKWH[nama_kWh_Meter]);
                });

                requestDailyKWH.on("done", () => {
                  
                    resolve(tampilDataAktualDailySolarPV);
                  
                });

                requestDailyKWH.on("error", (err) => {
                  console.error("Error during query Daily KWH execution:", err);
                  reject(err);
                });
              })
      return tampilDataAktualDailySolarPV; // Mengembalikan finalDataToSend
    } catch (err) {
      console.log(`Error Tampil Data KWH`);
    }

  };

  function getFiscalMonths(startYear, endYear) {
    const fiscalMonths = [];
  
    // Menambahkan bulan dari Maret (tahun startYear) hingga Desember
    for (let month = 3; month <= 12; month++) {
      const monthStr = month.toString().padStart(2, "0");
      fiscalMonths.push(`${startYear}-${monthStr}`);
    }
  
    // Menambahkan bulan dari Januari hingga April (tahun endYear)
    for (let month = 1; month <= 4; month++) {
      const monthStr = month.toString().padStart(2, "0");
      fiscalMonths.push(`${endYear}-${monthStr}`);
    }
  
    return fiscalMonths;
  }
  
  
  const tampilsolarPVMonthly = async () => {
    try {
      await new Promise((resolve, reject) => {
                const logWaktuWIB = moment()
                  .tz("Asia/Jakarta")
                  .format("YYYY-MM-DD");
                  const { startDate, endDate } = getFiscalYearRange(fisicalYear);
            //      const months = getFiscalMonths(startDate, endDate);
             //   console.log(startDate,endDate);

                const requestDailyKWH = new sql.Request(connectionPool);
                let resultMonthlyKWH = []; // Menyimpan hasil berdasarkan nama_kWh_Meter

                requestDailyKWH.stream = true;

                // Query untuk mendapatkan data perjam terakhir
                requestDailyKWH.query(
                  `SELECT 
                  log_waktu, no_kWh_Meter, nama_kWh_Meter, kWh_PLN,cost_PLN
                  FROM tbl_log_kWh_PLTS_perBulan
                  WHERE log_waktu >= '${startDate}' AND log_waktu <= '${endDate}'
                  ORDER BY log_waktu ASC`
                );

                // Proses data saat row datang
                requestDailyKWH.on("row", (row) => {
                  const decryptedRow = { ...row };
                  // Dekripsi dan parse field numerik
                  ["kWh_PLN", "cost_PLN"].forEach((field) => {
                    try {
                      // decryptedRow[field] = parseFloat(
                      //   atuwokzDecode(decodeBase64(decryptAES(row[field])))
                      // ); //blm di pakai
                      decryptedRow[field] = parseFloat(row[field]);
                    } catch {
                      decryptedRow[field] = 0; // Jika dekripsi gagal, set ke 0
                    }
                  });
                  //console.log(decryptedRow);

                  // Extract field yang diperlukan
                  const {
                    nama_kWh_Meter,
                    no_kWh_Meter,
                    log_waktu,
                    kWh_PLN,
                    cost_PLN,
                  } = decryptedRow;

                  // Destructuring new WAY data meter jika belum ada
                
                  resultMonthlyKWH[nama_kWh_Meter] = {
                      nama_kWh_Meter,
                      no_kWh_Meter,
                      log_waktu,
                      PVProd:kWh_PLN ,
                      cost_PLN,
                    };
                  

                   //console.log(`HAHAH`, resultDailyKWH[nama_kWh_Meter]);
                  // Update data meter
                  //let meterData = resultDailyKWH[nama_kWh_Meter]; tampilDataAktualMonthlySolarPV = { MonthlyAktualSolarPV: [] };

                  tampilDataAktualMonthlySolarPV.MonthlyAktualSolarPV.push(resultMonthlyKWH[nama_kWh_Meter]);
                });

                requestDailyKWH.on("done", () => {
                  
                    resolve(tampilDataAktualMonthlySolarPV);
                  
                });

                requestDailyKWH.on("error", (err) => {
                  console.error("Error during query Daily KWH execution:", err);
                  reject(err);
                });
              })
      return tampilDataAktualMonthlySolarPV; // Mengembalikan finalDataToSend
    } catch (err) {
      console.log(`Error Tampil Data KWH`);
    }

  };



  const tampilHourlydatalManagement = async () => {
    try {
     
      await new Promise((resolve, reject) => {
        const logWaktuWIB = moment()
        .tz("Asia/Jakarta")
        .format("YYYY-MM-DD");

        const request = new sql.Request(connectionPool);

        let resultDailyPlan = [];

        // console.log(date_start,date_end);

      const query = `
        SELECT [totalPLNKWH]
          ,[totalPanelKWH]
          ,[totalPVKWH]
          ,[totalPLNCost]
          ,[totalPVIncome]
          ,[RECexpe]
          ,[EmisiPLN]
          ,[EEI]
          ,[log_waktu]
        FROM [senkutoyota].[dbo].[tbl_Managementlog_perJam]
        WHERE CONVERT(VARCHAR, [log_waktu], 120) like '${logWaktuWIB}%'
        ORDER BY log_waktu ASC
        `;
        request.stream = true;

        request.query(query);

        
        request.on("row", (row) => {
          const dataTemp = {};
          Object.keys(row).forEach((field) => {
            dataTemp[field] = row[field];
          });

          const {
            totalPLNKWH,
            totalPanelKWH, // Tanggal akan dikonversi jika perlu
            totalPLNCost,
            totalPVIncome,
            RECexpe,
            EmisiPLN,
            EEI,
            log_waktu
          } = dataTemp;

          //const formattedDate = date ? new Date(date) : null;  // Mengonversi string ke objek Date

          // Membuat objek baru untuk menyimpan data yang diperlukan
          resultDailyPlan = {
            totalPLNKWH,
            totalPanelKWH, // Tanggal akan dikonversi jika perlu
            totalPLNCost,
            totalPVIncome,
            RECexpe,
            EmisiPLN,
            EEI,
            log_waktu
          };

          // Tambahkan data ke array DailyPlanKWH  const tampilDataAktualHourlyManagement = {HourlyData:[]},
          tampilDataAktualHourlyManagement.HourlyData.push(resultDailyPlan);

        });
          //const kwhPlan = resultDailyPlan;
          //console.log(resultDailyPlan);

        request.on("done", () => {
          //console.log(tampilDataPlanDailyKWH);
        
          // Selesaikan promise dengan data lengkap
          resolve(tampilDataAktualHourlyManagement);
        });
      
      });
      return tampilDataAktualHourlyManagement;
    } catch (err) {}
  };

  const tampildailydataManagement = async () => {
    try {
     
      await new Promise((resolve, reject) => {
        const logWaktuWIB = moment()
        .tz("Asia/Jakarta")
        .format("YYYY-MM-DD");

        const today = new Date();
        const dayOfWeek = today.getDay(); // 0 = Minggu, 1 = Senin, ..., 6 = Sabtu
        const monday = new Date(today);
        monday.setDate(today.getDate() - dayOfWeek + 1); // Set tanggal ke Senin
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6); // Set tanggal ke Minggu

        // Format tanggal ke 'YYYY-MM-DD'
        const date_start = monday.toISOString().split("T")[0];
        const date_end = sunday.toISOString().split("T")[0];

        const request = new sql.Request(connectionPool);

        let resultDailyPlan = [];

        // console.log(date_start,date_end);

        const query = `
        SELECT [totalPLNKWH]
          ,[totalPanelKWH]
          ,[totalPVKWH]
          ,[totalPLNCost]
          ,[totalPVIncome]
          ,[RECexpe]
          ,[EmisiPLN]
          ,[EEI]
          ,[log_waktu]
        FROM [senkutoyota].[dbo].[tbl_Managementlog_perHari]
        WHERE CONVERT(VARCHAR, [log_waktu], 120) >= '${date_start}' and CONVERT(VARCHAR, [log_waktu], 120) <= '${date_end}%'
        ORDER BY log_waktu ASC
        `;
        request.stream = true;

        request.query(query);

        
        request.on("row", (row) => {
          const dataTemp = {};
          Object.keys(row).forEach((field) => {
            dataTemp[field] = row[field];
          });

          const {
            totalPLNKWH,
            totalPanelKWH, // Tanggal akan dikonversi jika perlu
            totalPLNCost,
            totalPVIncome,
            RECexpe,
            EmisiPLN,
            EEI,
            log_waktu
          } = dataTemp;

          //const formattedDate = date ? new Date(date) : null;  // Mengonversi string ke objek Date

          // Membuat objek baru untuk menyimpan data yang diperlukan
          resultDailyPlan = {
            totalPLNKWH,
            totalPanelKWH, // Tanggal akan dikonversi jika perlu
            totalPLNCost,
            totalPVIncome,
            RECexpe,
            EmisiPLN,
            EEI,
            log_waktu
          };

          // Tambahkan data ke array DailyPlanKWH tampilDataAktualDailyManagement = {DailyData:[]},
          tampilDataAktualDailyManagement.DailyData.push(resultDailyPlan);

        });
          //const kwhPlan = resultDailyPlan;
          //console.log(resultDailyPlan);

        request.on("done", () => {
          //console.log(tampilDataPlanDailyKWH);
        
          // Selesaikan promise dengan data lengkap
          resolve(tampilDataAktualDailyManagement);
        });
      
      });
      return tampilDataAktualDailyManagement;
    } catch (err) {}
  };

  const tampilmonthlydataManagement = async () => {
    try {
     
      await new Promise((resolve, reject) => {
        const logWaktuWIB = moment()
        .tz("Asia/Jakarta")
        .format("YYYY-MM-DD");

        const { startDate, endDate } = getFiscalYearRange(fisicalYear);

        const request = new sql.Request(connectionPool);

        let resultMonthlyPlan = [];

        // console.log(date_start,date_end);

        const query = `
        SELECT [totalPLNKWH]
          ,[totalPanelKWH]
          ,[totalPVKWH]
          ,[totalPLNCost]
          ,[totalPVIncome]
          ,[RECexpe]
          ,[EmisiPLN]
          ,[EEI]
          ,[log_waktu]
        FROM [senkutoyota].[dbo].[tbl_Managementlog_perBulan]
        WHERE CONVERT(VARCHAR, [log_waktu], 120) >= '${startDate}' and CONVERT(VARCHAR, [log_waktu], 120) <= '${endDate}%'
        ORDER BY log_waktu ASC
        `;
        request.stream = true;

        request.query(query);

        
        request.on("row", (row) => {
          const dataTemp = {};
          Object.keys(row).forEach((field) => {
            dataTemp[field] = row[field];
          });

          const {
            totalPLNKWH,
            totalPanelKWH, // Tanggal akan dikonversi jika perlu
            totalPLNCost,
            totalPVIncome,
            RECexpe,
            EmisiPLN,
            EEI,
            log_waktu
          } = dataTemp;

          //const formattedDate = date ? new Date(date) : null;  // Mengonversi string ke objek Date

          // Membuat objek baru untuk menyimpan data yang diperlukan
          resultMonthlyPlan = {
            totalPLNKWH,
            totalPanelKWH, // Tanggal akan dikonversi jika perlu
            totalPLNCost,
            totalPVIncome,
            RECexpe,
            EmisiPLN,
            EEI,
            log_waktu
          };

          // Tambahkan data ke array DailyPlanKWH  tampilDataAktualMonthlyManagement = {MonthlyData:[]};
          tampilDataAktualMonthlyManagement.MonthlyData.push(resultMonthlyPlan);

        });
          //const kwhPlan = resultDailyPlan;
          //console.log(resultDailyPlan);

        request.on("done", () => {
          //console.log(tampilDataPlanDailyKWH);
        
          // Selesaikan promise dengan data lengkap
          resolve(tampilDataAktualMonthlyManagement);
        });
      
      });
      return tampilDataAktualMonthlyManagement;
    } catch (err) {}
  };

  

  const tampilTabelsolarPVDaily = async () => {
    try {
      
      await new Promise((resolve, reject) => {
                const logWaktuWIB = moment()
                  .tz("Asia/Jakarta")
                  .format("YYYY-MM-DD");

                const requestDailyKWH = new sql.Request(connectionPool);
                let resultDailyKWH = []; // Menyimpan hasil berdasarkan nama_kWh_Meter

                //console.log(mondayStr,sundayStr);
                requestDailyKWH.stream = true;

                // Query untuk mendapatkan data perjam terakhir
                requestDailyKWH.query(
                  `SELECT 
                  log_waktu, no_kWh_Meter, nama_kWh_Meter, kWh_PLN,cost_PLN
                  FROM tbl_log_kWh_PLTS_perHari
                  WHERE log_waktu = '${logWaktuWIB}'
                  ORDER BY log_waktu ASC`
                );

                // Proses data saat row datang
                requestDailyKWH.on("row", (row) => {
                  const decryptedRow = { ...row };
                  // Dekripsi dan parse field numerik
                  ["kWh_PLN", "cost_PLN"].forEach((field) => {
                    try {
                      // decryptedRow[field] = parseFloat(
                      //   atuwokzDecode(decodeBase64(decryptAES(row[field])))
                      // ); //blm di pakai
                      decryptedRow[field] = parseFloat(row[field]);
                    } catch {
                      decryptedRow[field] = 0; // Jika dekripsi gagal, set ke 0
                    }
                  });
                  //console.log(decryptedRow);

                  // Extract field yang diperlukan
                  const {
                    nama_kWh_Meter,
                    no_kWh_Meter,
                    log_waktu,
                    kWh_PLN,
                    cost_PLN,
                  } = decryptedRow;

                  // Destructuring new WAY data meter jika belum ada
                
                    resultDailyKWH[nama_kWh_Meter] = {
                      nama_kWh_Meter,
                      no_kWh_Meter,
                      log_waktu,
                      PVProd:kWh_PLN ,
                      cost_PLN,
                    };
                  

                   //console.log(`HAHAH`, resultDailyKWH[nama_kWh_Meter]);
                  // Update data meter  
                  // const tampilDataTabelDailySolarPV = { DailyTabelSolarPV: {} },
                  // tampilDataTabelMonthlySolarPV = { MonthlyTabelSolarPV: {} },
                  // tampilDataTabelYearlySolarPV = { YearlyTabelSolarPV: {} };

                  //let meterData = resultDailyKWH[nama_kWh_Meter];

                  tampilDataTabelDailySolarPV.DailyTabelSolarPV.push(resultDailyKWH[nama_kWh_Meter]);
                });

                requestDailyKWH.on("done", () => {
                  
                    resolve(tampilDataTabelDailySolarPV);
                  
                });

                requestDailyKWH.on("error", (err) => {
                  console.error("Error during query Daily KWH execution:", err);
                  reject(err);
                });
              })
      return tampilDataTabelDailySolarPV; // Mengembalikan finalDataToSend
    } catch (err) {
      console.log(`Error Tampil Data KWH`);
    }

  };

  const tampilTabelsolarPVMonthly = async () => {
    try {
      
      await new Promise((resolve, reject) => {
                const logWaktuWIB = moment()
                  .tz("Asia/Jakarta")
                  .format("YYYY-MM");

                const requestDailyKWH = new sql.Request(connectionPool);
                let resultDailyKWH = []; // Menyimpan hasil berdasarkan nama_kWh_Meter

                //console.log(mondayStr,sundayStr);
                requestDailyKWH.stream = true;

                // Query untuk mendapatkan data perjam terakhir
                requestDailyKWH.query(
                  `SELECT 
                  log_waktu, no_kWh_Meter, nama_kWh_Meter, kWh_PLN,cost_PLN
                  FROM tbl_log_kWh_PLTS_perBulan
                  WHERE  CONVERT(VARCHAR, log_waktu, 120) like '${logWaktuWIB}%'
                  ORDER BY log_waktu ASC`
                );

                // Proses data saat row datang
                requestDailyKWH.on("row", (row) => {
                  const decryptedRow = { ...row };
                  // Dekripsi dan parse field numerik
                  ["kWh_PLN", "cost_PLN"].forEach((field) => {
                    try {
                      // decryptedRow[field] = parseFloat(
                      //   atuwokzDecode(decodeBase64(decryptAES(row[field])))
                      // ); //blm di pakai
                      decryptedRow[field] = parseFloat(row[field]);
                    } catch {
                      decryptedRow[field] = 0; // Jika dekripsi gagal, set ke 0
                    }
                  });
                  //console.log(decryptedRow);

                  // Extract field yang diperlukan
                  const {
                    nama_kWh_Meter,
                    no_kWh_Meter,
                    log_waktu,
                    kWh_PLN,
                    cost_PLN,
                  } = decryptedRow;

                  // Destructuring new WAY data meter jika belum ada
                
                    resultDailyKWH[nama_kWh_Meter] = {
                      nama_kWh_Meter,
                      no_kWh_Meter,
                      log_waktu,
                      PVProd:kWh_PLN ,
                      cost_PLN,
                    };
                  

                   //console.log(`HAHAH`, resultDailyKWH[nama_kWh_Meter]);
                  // Update data meter  
                  // const tampilDataTabelDailySolarPV = { DailyTabelSolarPV: {} },
                  // tampilDataTabelMonthlySolarPV = { MonthlyTabelSolarPV: {} },
                  // tampilDataTabelYearlySolarPV = { YearlyTabelSolarPV: {} };

                  //let meterData = resultDailyKWH[nama_kWh_Meter];

                  tampilDataTabelMonthlySolarPV.MonthlyTabelSolarPV.push(resultDailyKWH[nama_kWh_Meter]);
                });

                requestDailyKWH.on("done", () => {
                  
                    resolve(tampilDataTabelMonthlySolarPV);
                  
                });

                requestDailyKWH.on("error", (err) => {
                  console.error("Error during query Daily KWH execution:", err);
                  reject(err);
                });
              })
      return tampilDataTabelMonthlySolarPV; // Mengembalikan finalDataToSend
    } catch (err) {
      console.log(`Error Tampil Data KWH`);
    }

  };

  const tampilTabelsolarPVYearly = async () => {
    try {
      
      await new Promise((resolve, reject) => {
                const logWaktuWIB = moment()
                  .tz("Asia/Jakarta")
                  .format("YYYY");

                const requestDailyKWH = new sql.Request(connectionPool);
                let resultDailyKWH = []; // Menyimpan hasil berdasarkan nama_kWh_Meter

              //  console.log(logWaktuWIB);
                requestDailyKWH.stream = true;

                // Query untuk mendapatkan data perjam terakhir
                requestDailyKWH.query(
                  `SELECT 
                  log_waktu, no_kWh_Meter, nama_kWh_Meter, kWh_PLN,cost_PLN
                  FROM tbl_log_kWh_PLTS_perTahun
                  WHERE  CONVERT(VARCHAR, log_waktu, 120) like '%${logWaktuWIB}%'
                  ORDER BY log_waktu ASC`
                );

                // Proses data saat row datang
                requestDailyKWH.on("row", (row) => {
                  const decryptedRow = { ...row };
                  // Dekripsi dan parse field numerik
                  ["kWh_PLN", "cost_PLN"].forEach((field) => {
                    try {
                      // decryptedRow[field] = parseFloat(
                      //   atuwokzDecode(decodeBase64(decryptAES(row[field])))
                      // ); //blm di pakai
                      decryptedRow[field] = parseFloat(row[field]);
                    } catch {
                      decryptedRow[field] = 0; // Jika dekripsi gagal, set ke 0
                    }
                  });
                 // console.log(decryptedRow);

                  // Extract field yang diperlukan
                  const {
                    nama_kWh_Meter,
                    no_kWh_Meter,
                    log_waktu,
                    kWh_PLN,
                    cost_PLN,
                  } = decryptedRow;

                  // Destructuring new WAY data meter jika belum ada
                
                    resultDailyKWH[nama_kWh_Meter] = {
                      nama_kWh_Meter,
                      no_kWh_Meter,
                      log_waktu,
                      PVProd:kWh_PLN ,
                      cost_PLN,
                    };
                  

                  // console.log(`HAHAH`, resultDailyKWH[nama_kWh_Meter]);
                  // Update data meter  
                  // const tampilDataTabelDailySolarPV = { DailyTabelSolarPV: {} },
                  // tampilDataTabelMonthlySolarPV = { MonthlyTabelSolarPV: {} },
                  // tampilDataTabelYearlySolarPV = { YearlyTabelSolarPV: {} };

                  //let meterData = resultDailyKWH[nama_kWh_Meter];

                  tampilDataTabelYearlySolarPV.YearlyTabelSolarPV.push(resultDailyKWH[nama_kWh_Meter]);
                  //console.log(tampilDataTabelYearlySolarPV);
                });

                requestDailyKWH.on("done", () => {
                  
                    resolve(tampilDataTabelYearlySolarPV);
                  
                });

                requestDailyKWH.on("error", (err) => {
                  console.error("Error during query Daily KWH execution:", err);
                  reject(err);
                });
              })
      return tampilDataTabelYearlySolarPV; // Mengembalikan finalDataToSend
    } catch (err) {
      console.log(`Error Tampil Data KWH`);
    }

  };



  const dailyKWH = await tampilDailyKWHPLN();
  const monthlyKWH = await tampilMonthlyKWHPLN();
  const dailyPlanCostKWH = await tampilDailyPlanKWHPLN();
  const monthlyPlanCostKWH = await tampilMonthlyPlanKWHPLN();
  const dailyTabelData = await tampildailyTabelManagement();
  const monthlyTabeldata = await tampilmonthlyTabelManagement();
  const yearlyTabeldata = await tampilyearlyTabelManagement();
  const HourlysolarPVData = await tampilsolarPVHourly();
  const DailysolarPVData = await tampilsolarPVDaily();
  const MonthlysolarPV = await tampilsolarPVMonthly(); 
  const HourlyManagementData = await tampilHourlydatalManagement();
  const DailyManagementData = await tampildailydataManagement();
  const MonthlyManagementData = await tampilmonthlydataManagement();
  const dailyTabelSolarPV = await tampilTabelsolarPVDaily();
  const monthlyTabelSolarPV = await tampilTabelsolarPVMonthly();
  const yearlyTabelSolarPV = await tampilTabelsolarPVYearly();
  

  const combinedData = {
    success: true,
    data:{
       dailyKWH,
       monthlyKWH,
       dailyPlanCostKWH,
       monthlyPlanCostKWH,
       HourlysolarPVData,
       DailysolarPVData,
       MonthlysolarPV,
       dailyTabelData,
       monthlyTabeldata,
       yearlyTabeldata,
       HourlyManagementData,
       DailyManagementData,
       MonthlyManagementData,
       dailyTabelSolarPV,
       monthlyTabelSolarPV,
       yearlyTabelSolarPV
    }
  };

  const dataCache = await getCache("/manageDasboard");

  if (dataCache) {
    await deleteCache("/manageDasboard");

    await setCache("/manageDasboard", combinedData);
  } else {
    await setCache("/manageDasboard", combinedData);
  }
  return combinedData;
};

//await tampilMonthlyKWHPLN();

// ===================================================== End

//--ENDPOINT emissionMonitoring (belum done)
app.get("/emissionMonitoring", async (req, res) => {
  try {
    const request = new sql.Request(connectionPool);
    const result = await request.query(`
      SELECT TOP 1 
        emission_factor, 
        lbwp, 
        wbp,  
        total_cost_limit
      FROM tbl_set_value
      ORDER BY id DESC
    `);

    if (result.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Data konfigurasi tidak ditemukan di database.",
      });
    }

    const config = result.recordset[0];
    const EMISSION_FACTOR = parseFloat(config.emission_factor);

    if (!sanitizedTableNamesCache) {
      await initializeTableCache();
    }

    const logs = [];
    const promises = sanitizedTableNamesCache.map((tableName) => {
      return new Promise((resolve, reject) => {
        const request = new sql.Request(connectionPool);
        request.stream = true;

        request.query(`
          SELECT 
            CONVERT(VARCHAR(19), log_waktu, 120) AS log_waktu, 
            v_L1, 
            v_L2, 
            v_L3, 
            I_A1, 
            I_A2, 
            I_A3, 
            v_avg, 
            I_avg, 
            PF_avg 
          FROM ${tableName} 
          ORDER BY log_waktu DESC
        `);

        request.on("row", (row) => {
          const decryptedLog = { ...row };
          [
            "v_L1",
            "v_L2",
            "v_L3",
            "I_A1",
            "I_A2",
            "I_A3",
            "v_avg",
            "I_avg",
            "PF_avg",
          ].forEach((field) => {
            try {
              decryptedLog[field] = parseFloat(
                atuwokzDecode(decodeBase64(decryptAES(row[field])))
              );
            } catch {
              decryptedLog[field] = 0;
            }
          });
          logs.push(decryptedLog);
        });

        request.on("error", (err) => {
          console.error(`Error during query stream for ${tableName}:`, err);
          reject(err);
        });

        request.on("done", () => resolve());
      });
    });

    await Promise.all(promises);

    const groupLogsByGranularity = (logs, length) => {
      return logs.reduce((acc, log) => {
        const key = log.log_waktu.slice(0, length);
        if (!acc[key]) {
          acc[key] = [];
        }
        acc[key].push(log);
        return acc;
      }, {});
    };

    const calculateAggregatedMetrics = (groupedLogs) => {
      return Object.entries(groupedLogs).map(([time, logs]) => {
        let totalR = 0;
        let totalS = 0;
        let totalT = 0;
        let totalIA1 = 0;
        let totalIA2 = 0;
        let totalIA3 = 0;
        let totalEnergyConsumeR = 0;
        let totalEnergyConsumeS = 0;
        let totalEnergyConsumeT = 0;
        let totalEnergyConsume = 0;
        let totalPF = 0;
        logs.forEach((log) => {
          const R_AVG = log.v_L1;
          const S_AVG = log.v_L2;
          const T_AVG = log.v_L3;
          const IA1_AVG = log.I_A1;
          const IA2_AVG = log.I_A2;
          const IA3_AVG = log.I_A3;
          const PF_AVG = log.PF_avg;

          totalR += R_AVG;
          totalS += S_AVG;
          totalT += T_AVG;
          totalIA1 += IA1_AVG;
          totalIA2 += IA2_AVG;
          totalIA3 += IA3_AVG;
          totalPF += PF_AVG;

          // Energy consumption per phase
          const powerR = (R_AVG * IA1_AVG * PF_AVG) / 1000; // kW
          const powerS = (S_AVG * IA2_AVG * PF_AVG) / 1000; // kW
          const powerT = (T_AVG * IA3_AVG * PF_AVG) / 1000; // kW

          totalEnergyConsumeR += powerR * (1 / 60); // kWh per minute
          totalEnergyConsumeS += powerS * (1 / 60); // kWh per minute
          totalEnergyConsumeT += powerT * (1 / 60); // kWh per minute

          // Total energy consumption
          const totalPower = (log.v_avg * log.I_avg * PF_AVG) / 1000; // kW
          totalEnergyConsume += totalPower * (1 / 60); // kWh per minute
        });

        const count = logs.length;

        const R_AVG = totalR / count;
        const S_AVG = totalS / count;
        const T_AVG = totalT / count;
        const IA1_AVG = totalIA1 / count;
        const IA2_AVG = totalIA2 / count;
        const IA3_AVG = totalIA3 / count;
        const PF_AVG = totalPF / count;

        const energyConsumeActual = totalEnergyConsume * 1.6; // Actual consumption adjustment
        const emission = energyConsumeActual * EMISSION_FACTOR; // Emission calculation

        // Fungsi untuk menghitung rata-rata konsumsi energi per hari
        const calculateDailyAverage = (logs, daysElapsed) => {
          if (logs.length === 0 || daysElapsed === 0) return 0; // Validasi log kosong atau daysElapsed nol
          const totalEnergy = logs.reduce(
            (acc, log) => acc + (log.energyConsume || 0),
            0
          ); // Pastikan energyConsume valid
          return totalEnergy / daysElapsed;
        };

        // Hitung jumlah hari dalam bulan
        const currentDate = new Date();
        const daysInMonth = new Date(
          currentDate.getFullYear(),
          currentDate.getMonth() + 1,
          0
        ).getDate();

        // Hitung jumlah hari unik dari data log
        const uniqueDays = logs.reduce((acc, log) => {
          const logDate = new Date(log.log_waktu).getDate();
          if (!acc.includes(logDate)) acc.push(logDate);
          return acc;
        }, []);
        const daysElapsed = uniqueDays.length || 0; // Pastikan daysElapsed minimal 0

        // Rata-rata konsumsi harian
        const energyConsume_AVG = calculateDailyAverage(logs, daysElapsed);

        // Prediksi konsumsi energi
        let predictedEnergyConsume;
        if (energyConsume_AVG > 0 && daysElapsed > 0) {
          const remainingDays = Math.max(daysInMonth - daysElapsed, 0);
          const predictedFromAvg = energyConsume_AVG * remainingDays;

          // Total prediksi = konsumsi aktual + prediksi untuk sisa hari
          predictedEnergyConsume = energyConsumeActual + predictedFromAvg;
        } else {
          // Jika data tidak cukup, gunakan konsumsi aktual sebagai prediksi dasar
          predictedEnergyConsume = energyConsumeActual;
        }

        // Pastikan prediksi tidak lebih kecil dari konsumsi aktual
        predictedEnergyConsume = Math.max(
          predictedEnergyConsume,
          energyConsumeActual
        );

        // Perhitungan konsumsi aktual disesuaikan
        const adjustmentFactor = 1.6; // Faktor penyesuaian
        const predictedEnergyConsumeActual =
          predictedEnergyConsume * adjustmentFactor;

        // Hitung emisi yang diprediksi
        const predictedEmission =
          predictedEnergyConsumeActual * EMISSION_FACTOR;

        return {
          time,
          R_AVG,
          S_AVG,
          T_AVG,
          IA1_AVG,
          IA2_AVG,
          IA3_AVG,
          PF_AVG,
          energyConsumeR: totalEnergyConsumeR,
          energyConsumeS: totalEnergyConsumeS,
          energyConsumeT: totalEnergyConsumeT,
          energyConsume: totalEnergyConsume,
          energyConsumeActual,
          energyConsume_AVG:
            daysElapsed > 0 ? totalEnergyConsume / daysElapsed : 0,
          predictedEnergyConsume,
          predictedEnergyConsumeActual,
          emission,
          emission_AVG: daysElapsed > 0 ? emission / daysElapsed : 0,
          predictedEmission,
        };
      });
    };

    const monthlyGroupedLogs = groupLogsByGranularity(logs, 7); // YYYY-MM
    const monthlyData = calculateAggregatedMetrics(monthlyGroupedLogs);

    res.json({
      success: true,
      data: {
        monthlyData,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: `Terjadi kesalahan saat mengolah data: ${err.message}`,
    });
  }
});

// ENDPOINT NERIMA DATA DARI ALAT
app.post("/addData/:floor", async (req, res) => {
  // Mulai logging
  try {
    const { floor } = req.params;
    // Validate floor parameter
    if (!floorTableMap[floor]) {
      return res.status(400).json({
        success: false,
        message: "Invalid floor parameter",
      });
    }

    const tableName = floorTableMap[floor];
    const {
      no_kWh_Meter,
      v_avg,
      I_avg,
      PF_avg,
      kVA,
      kW,
      kVArh,
      freq,
      v_L1,
      v_L2,
      v_L3,
      v_12,
      v_23,
      v_31,
      I_A1,
      I_A2,
      I_A3,
    } = req.body;

    // Validasi field yang diperlukan
    if (
      !no_kWh_Meter ||
      !v_avg ||
      !I_avg ||
      !PF_avg ||
      !kVA ||
      !kW ||
      !kVArh ||
      !freq ||
      !v_L1 ||
      !v_L2 ||
      !v_L3 ||
      !v_12 ||
      !v_23 ||
      !v_31 ||
      !I_A1 ||
      !I_A2 ||
      !I_A3
    ) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields in request body",
      });
    }

    // Query untuk mendapatkan nama meter
    const meterQuery = await connectionPool
      .request()
      .input("no_kWh_Meter", sql.NVarChar, no_kWh_Meter)
      .query(
        `SELECT nama_kWh_Meter FROM ${tableName} WHERE no_kWh_Meter = @no_kWh_Meter`
      );

    if (meterQuery.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: `no_kWh_Meter ${no_kWh_Meter} not found in ${tableName}`,
      });
    }

    const nama_kWh_Meter = meterQuery.recordset[0].nama_kWh_Meter;
    // Sanitize nama_kWh_Meter untuk nama tabel
    const sanitizedTableName = `tbl_log_${nama_kWh_Meter.replace(
      /[^a-zA-Z0-9_]/g,
      "_"
    )}`;
    // Periksa apakah tabel log ada
    const tableCheck = await connectionPool
      .request()
      .query(
        `SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = '${sanitizedTableName}'`
      );

    if (tableCheck.recordset.length === 0) {
      return res.status(400).json({
        success: false,
        message: `Log table ${sanitizedTableName} does not exist`,
      });
    }

    const logWaktuWIB =
      req.body.log_waktu ||
      moment().tz("Asia/Jakarta").format("YYYY-MM-DD HH:mm:ss");

    await connectionPool
      .request()
      .input("no_kWh_Meter", sql.NVarChar, no_kWh_Meter)
      .input("nama_kWh_Meter", sql.NVarChar, nama_kWh_Meter)
      .input("freq", sql.NVarChar, freq)
      .input("v_avg", sql.NVarChar, v_avg)
      .input("I_avg", sql.NVarChar, I_avg)
      .input("PF_avg", sql.NVarChar, PF_avg)
      .input("kVA", sql.NVarChar, kVA)
      .input("kW", sql.NVarChar, kW)
      .input("kVArh", sql.NVarChar, kVArh)
      .input("v_L1", sql.NVarChar, v_L1)
      .input("v_L2", sql.NVarChar, v_L2)
      .input("v_L3", sql.NVarChar, v_L3)
      .input("v_12", sql.NVarChar, v_12)
      .input("v_23", sql.NVarChar, v_23)
      .input("v_31", sql.NVarChar, v_31)
      .input("I_A1", sql.NVarChar, I_A1)
      .input("I_A2", sql.NVarChar, I_A2)
      .input("I_A3", sql.NVarChar, I_A3)
      .input("log_waktu", sql.NVarChar, logWaktuWIB).query(`
        INSERT INTO ${sanitizedTableName} (
            no_kWh_Meter, nama_kWh_Meter, freq, v_avg, I_avg, PF_avg, 
            kVA, kW, kVArh, v_L1, v_L2, v_L3, 
            v_12, v_23, v_31, I_A1, I_A2, I_A3, log_waktu
        ) VALUES (
            @no_kWh_Meter, @nama_kWh_Meter, @freq, @v_avg, @I_avg, @PF_avg, 
            @kVA, @kW, @kVArh, @v_L1, @v_L2, @v_L3, 
            @v_12, @v_23, @v_31, @I_A1, @I_A2, @I_A3, @log_waktu
        )`);
    res.json({
      success: true,
      message: `Data successfully inserted into log table ${sanitizedTableName}`,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: `Error inserting data: ${err.message}`,
    });
  } finally {
  }
});

//--ENDPOINT ROOT
app.get("/", (req, res) => {
  res.status(200).send("<h1>Server is running</h1>");
});

// Endpoint untuk monitoring penggunaan CPU dan RAM MSSQL
app.get("/m", async (req, res) => {
  try {
    // Query untuk Memory in Use (MB)
    const queryMemory = `
      SELECT 
        TRY_CONVERT(INT, physical_memory_in_use_kb / 1024) AS memory_in_use_mb
      FROM sys.dm_os_process_memory;
    `;

    // Jalankan query
    const pool = await connectionPool; // Pastikan koneksi pool sudah siap
    const memoryResult = await pool.request().query(queryMemory);

    // Validasi hasil query
    const memoryData =
      (memoryResult.recordset && memoryResult.recordset[0]) || {};

    // Format hasil untuk response
    const response = {
      memory: {
        in_use_MB: memoryData.memory_in_use_mb || 0,
      },
    };

    res.status(200).json(response);
  } catch (err) {
    console.error("Error fetching MSSQL memory stats:", err);
    res.status(500).json({
      error: "Failed to fetch MSSQL memory stats",
      details: err.message,
    });
  }
});

app.get("/data/:nokwhmeter", async (req, res) => {
  const { nokwhmeter } = req.params; // Get nokwhmeter parameter from URL

  // Mapping lantai to corresponding table names
  const floorTableMap = {
    lantai1: ["tbl_lantai_1", "tbl_lantai_ground"],
    lantai1_annex: ["tbl_lantai_1_annex"],
    lantai2: ["tbl_lantai_2"],
    lantai2_annex: ["tbl_lantai_2_annex"],
    lantai3: ["tbl_lantai_3"],
    lantai3_annex: ["tbl_lantai_3_annex"],
    lantai4: ["tbl_lantai_4"],
    lantai5: ["tbl_lantai_5"],
    lantai6: ["tbl_lantai_6"],
    lantai7: ["tbl_lantai_7"],
    lantai8: ["tbl_lantai_8"],
    lantaiEksternal: ["tbl_eksternal"],
  };

  // Dapatkan semua tabel terkait
  const allTableNames = Object.values(floorTableMap).flat();

  try {
    // Cari data meter di semua tabel lantai
    const meterPromises = allTableNames.map((tableName) =>
      connectionPool.request().query(`
              SELECT 
              no_kWh_Meter, 
              nama_kWh_Meter, 
              ruangan, 
              no_panel,
              '${tableName}' AS lantai
              FROM ${tableName}
              WHERE no_kWh_Meter = ${nokwhmeter}
          `)
    );

    const meterResults = await Promise.all(meterPromises);
    let kwhMeter = meterResults.flatMap((result) => result.recordset);

    if (kwhMeter.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Tidak ditemukan data untuk no_kWh_Meter ${nokwhmeter}`,
      });
    }

    const meter = kwhMeter[0]; // Ambil data pertama (hanya satu meter yang ditemukan)

    // Mengambil nama log table untuk dekripsi
    const sanitizedTableName = `tbl_log_${meter.nama_kWh_Meter.replace(
      /[^a-zA-Z0-9_]/g,
      "_"
    )}`;

    // Mengecek apakah tabel log ada
    const tableCheckQuery = `
          SELECT TABLE_NAME 
          FROM INFORMATION_SCHEMA.TABLES 
          WHERE TABLE_NAME = '${sanitizedTableName}'
      `;
    const tableCheckResult = await connectionPool
      .request()
      .query(tableCheckQuery);

    if (tableCheckResult.recordset.length === 0) {
      meter.logs = [];
    } else {
      // Mengambil log untuk meter
      const logsQuery = `
              SELECT *
              FROM ${sanitizedTableName}
              WHERE no_kWh_Meter = ${nokwhmeter}
              ORDER BY log_waktu DESC
          `;
      const logsResult = await connectionPool.request().query(logsQuery);

      // Daftar field yang terenkripsi untuk dekripsi
      const encryptedFields = [
        "v_avg",
        "I_avg",
        "PF_avg",
        "kVA",
        "kW",
        "kVArh",
        "freq",
        "v_L1",
        "v_L2",
        "v_L3",
        "v_12",
        "v_23",
        "v_31",
        "I_A1",
        "I_A2",
        "I_A3",
      ];

      // Dekripsi log untuk setiap field terenkripsi
      meter.logs = logsResult.recordset.map((log) => {
        const decryptedLog = { ...log };
        for (const field of encryptedFields) {
          if (decryptedLog[field]) {
            try {
              const decryptedString = decryptAES(decryptedLog[field]);
              const base64Decoded = decodeBase64(decryptedString);
              decryptedLog[field] = atuwokzDecode(base64Decoded);
            } catch (error) {
              console.error(
                `Error decrypting field ${field} for meter ${meter.nama_kWh_Meter}:`,
                error.message
              );
              decryptedLog[field] = null;
            }
          }
        }
        return decryptedLog;
      });
    }

    // Hanya ambil lantai dan no_panel
    const responseData = {
      no_kWh_Meter: meter.no_kWh_Meter,
      nama_kWh_Meter: meter.nama_kWh_Meter,
      ruangan: meter.ruangan,
      no_panel: meter.no_panel,
      lantai: meter.lantai,
      logs: meter.logs, // Menyertakan logs yang sudah didekripsi
    };

    // Respond dengan data meter
    res.json({
      success: true,
      message: `Data berhasil diambil untuk no_kWh_Meter ${nokwhmeter}`,
      data: responseData,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: `Terjadi kesalahan saat mengambil data: ${err.message}`,
    });
  }
});

// initializeConnectionPool().then(() => {
//   // Kemudian set interval untuk menjalankan kedua fungsi setiap 50 detik setelah delay awal
//   setInterval(runFloorCalculations, 600000);
//   setInterval(calculateDashboard, 600000);
// });

// Endpoint untuk menjalankan kedua fungsi
app.get("/run", async (req, res) => {
  // Kirim respons segera
  res.status(200).json({ success: true, message: "Sedang di hitung" });

  // Jalankan kedua fungsi secara asinkron
  try {
    await runFloorCalculations();
    console.log("Floor calculations completed.");
  } catch (error) {
    console.error("Error during floor calculations:", error);
  }

  try {
    await calculateDashboard();
    console.log("Dashboard calculations completed.");
  } catch (error) {
    console.error("Error during dashboard calculations:", error);
  }
  try {
    await calculateSolarPV();
    console.log("SolarPV calculations completed.");
  } catch (error) {
    console.error("Error during SolarPV calculations:", error);
  }
});

initializeConnectionPool().then(async () => {
  await DashboardManagement();

  // Jalankan kalkulasi saat server pertama kali berjalan
  //   await runFloorCalculations();
  //   await calculateDashboard();
  //   await calculateSolarPV();
  //   await runDasboradOperator();
  // await SetupDataperJam();
  // await queryPLTSperJam();
  //   // // Kemudian set interval untuk menjalankan kedua fungsi setiap 10 menit
  //   setInterval(async () => {
  //     await runFloorCalculations();
  //   }, 60000); // 1 menit
  //   setInterval(async () => {
  //     await calculateDashboard();
  //   }, 60000); // 1 menit
  //   setInterval(async () => {
  //     await calculateSolarPV();
  //   }, 60000); // 1 menit
  // setInterval(async () => {
  //     await runDasboradOperator();
  //   }, 60000); // 1 menit
  setInterval(async () => {
    await DashboardManagement();
  }, 1200000);

  //await queryPLTSperHari();
  //await queryPanelperHari();
  // await finalAllDataDaily();

  //  setInterval(async () => {
  //   console.log(`Running Update Data Hour : `);
  //   const freshData = await finalAllDataHourly();
  //   insertHourlyData(freshData);
  // }, 100); // 3600000 60 menit
  // let count = 0;
  // do  {
  // setInterval(async () => {
  //   console.log(`Running Update Data Yearly : `);
  //   const freshData = await finalAllDataYearly();
  //   insertYearlyData(freshData);
  // }, 5000); // 3600000 60 menit
  //   count++;
  // }while (count < 12);

  // setInterval(async () => {
  //   console.log(`Running Update Data Hour : `);
  //   const freshData = await finalAllDataDaily();
  //   insertDailyData(freshData);
  // }, 1000); // 3600000 60 menit

  // setInterval(async () => {
  //   console.log(`Running Update Data Monthly : `);
  //   const freshData = await finalAllDataMonthly();
  //   insertMonthlyData(freshData);
  // }, 40000); // 3600000 60 menit

  // setInterval(async () => {
  //   console.log(`Running Update Data Yearly : `);
  //   const freshData = await finalAllDataYearly();
  //   insertYearlyData(freshData);
  // }, 55000); // 3600000 60 menit
});

// ======================================== Run Scheduling

let shouldContinue = true; // Kontrol untuk menghentikan tugas jika diperlukan

//Fungsi untuk menghentikan tugas terjadwal
function stopScheduledTasks() {
  shouldContinue = false;
  console.log("All scheduled tasks have been stopped.");
}

//Fungsi untuk mendapatkan waktu eksekusi berikutnya
function getNextExecutionTime(interval) {
  const now = moment().tz("Asia/Jakarta");
  let nextExecution;

  switch (interval) {
    case "hourly":
      nextExecution = now.clone().startOf("hour").add(1, "hour");
      break;
    case "daily":
      nextExecution = now.clone().startOf("day").add(1, "day");
      break;
    case "monthly":
      nextExecution = now.clone().startOf("month").add(1, "month");
      break;
    case "yearly":
      nextExecution = now.clone().startOf("year").add(1, "year");
      break;
    default:
      throw new Error(`Unknown interval: ${interval}`);
  }

  return nextExecution;
}

// Fungsi untuk menjadwalkan tugas
function scheduleTask(interval, taskFn) {
  if (!shouldContinue) {
    console.log(`Stopping ${interval} task.`);
    return;
  }

  const now = moment().tz("Asia/Jakarta");
  const nextExecution = getNextExecutionTime(interval);
  const maxTimeout = 2 ** 31 - 1; // Batas maksimum setTimeout dalam milidetik
  let delay = nextExecution.diff(now);

  // Jika delay melebihi batas maksimum, batasi
  if (delay > maxTimeout) {
    delay = maxTimeout;
  }

  console.log(
    `Next ${interval} task scheduled in: ${delay / 1000} seconds (at ${nextExecution.format(
      "YYYY-MM-DD HH:mm:ss"
    )})`
  );

  setTimeout(async () => {
    if (moment().isBefore(nextExecution)) {
      // Jika belum waktunya, jadwalkan ulang
      scheduleTask(interval, taskFn);
    } else {
      console.log(`Running ${interval} task at: ${moment().format("YYYY-MM-DD HH:mm:ss")}`);
      await taskFn(); // Jalankan tugas
      scheduleTask(interval, taskFn); // Jadwalkan ulang untuk eksekusi berikutnya
    }
  }, delay);
}

// Fungsi contoh untuk setiap interval
async function hourlyTask() {
  console.log("Hourly task executed");
  // Tambahkan logika tugas di sini
}

async function dailyTask() {
  console.log("Daily task executed");
  // Tambahkan logika tugas di sini
}

async function monthlyTask() {
  console.log("Monthly task executed");
  // Tambahkan logika tugas di sini
}

async function yearlyTask() {
  console.log("Yearly task executed");
  // Tambahkan logika tugas di sini
}

// Memulai semua tugas terjadwal
function startScheduledTasks() {
  scheduleTask("hourly", hourlyTask);
  scheduleTask("daily", dailyTask);
  scheduleTask("monthly", monthlyTask);
  scheduleTask("yearly", yearlyTask);
}

// Jalankan tugas terjadwal
startScheduledTasks();

// Contoh menghentikan tugas setelah 1 menit
// setTimeout(() => {
//   stopScheduledTasks();
// }, 60000); // Hentikan setelah 60 detik

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Server running on port http://localhost:${PORT}`);
});
