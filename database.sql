-- Tabel: tbl_eksternal
CREATE TABLE tbl_eksternal (
    ruangan NVARCHAR(100) NULL,
    no_panel INT NULL,
    no_kWh_Meter INT NULL,
    nama_kWh_Meter NVARCHAR(100) NULL
);

INSERT INTO tbl_eksternal (ruangan, no_panel, no_kWh_Meter, nama_kWh_Meter) VALUES
    ('Ruang Carpool', 36, 61, 'Panel P-Carpool'),
    ('Ruang Genset', 35, 60, 'Panel Genset'),
    ('Ruang Koperasi', 37, 62, 'Panel P-Koperasi'),
    ('Ruang STP', 38, 63, 'Panel P-Transfer Pump'),
    ('Ruang STP', 38, 64, 'Panel P-STP');

-- Tabel: tbl_lantai_1
CREATE TABLE tbl_lantai_1 (
    ruangan NVARCHAR(100) NULL,
    no_panel INT NULL,
    no_kWh_Meter INT NULL,
    nama_kWh_Meter NVARCHAR(100) NULL
);

INSERT INTO tbl_lantai_1 (ruangan, no_panel, no_kWh_Meter, nama_kWh_Meter) VALUES
    ('Ruang AHU Podo', 2, 6, 'kWh AHU3-GL'),
    ('Ruang AHU Podo', 2, 7, 'kWh AHU4-GL'),
    ('Ruang AHU Yos', 1, 1, 'kWh PP-GL'),
    ('Ruang AHU Yos', 1, 2, 'kWh LP-GL'),
    ('Ruang AHU Yos', 1, 3, 'kWh LP-GR'),
    ('Ruang AHU Yos', 1, 4, 'kWh AHU1-GL'),
    ('Ruang AHU Yos', 1, 5, 'kWh AHU2-GL'),
    ('Ruang LVMDP', 4, 9, 'Power Quality LVMDP'),
    ('Ruang LVMDP', 3, 8, 'kWh PLTS');

-- Tabel: tbl_lantai_1_annex
CREATE TABLE tbl_lantai_1_annex (
    ruangan NVARCHAR(100) NULL,
    no_panel INT NULL,
    no_kWh_Meter INT NULL,
    nama_kWh_Meter NVARCHAR(100) NULL
);

INSERT INTO tbl_lantai_1_annex (ruangan, no_panel, no_kWh_Meter, nama_kWh_Meter) VALUES
    ('Ruang Panel', 5, 10, 'kWhP-Outgoing'),
    ('Ruang Panel', 5, 11, 'kWh SDP/B'),
    ('Ruang Panel', 5, 12, 'Panel PD-LT.1'),
    ('Ruang Panel', 5, 13, 'Panel PD-MZ');

-- Tabel: tbl_lantai_2
CREATE TABLE tbl_lantai_2 (
    ruangan NVARCHAR(100) NULL,
    no_panel INT NULL,
    no_kWh_Meter INT NULL,
    nama_kWh_Meter NVARCHAR(100) NULL
);

INSERT INTO tbl_lantai_2 (ruangan, no_panel, no_kWh_Meter, nama_kWh_Meter) VALUES
    ('Ruang AHU Podo', 7, 15, 'Panel AHU2-LT2'),
    ('Ruang AHU Yos', 8, 16, 'Panel AHU1-LT2'),
    ('Ruang AHU Yos', 8, 17, 'Panel PP-LT2'),
    ('Ruang AHU Yos', 8, 18, 'Panel LP-LT2'),
    ('Ruang AHU Yos', 8, 19, 'Panel LP-MEZ'),
    ('Ruang AHU Yos', 9, 20, 'P-Electronic');

-- Tabel: tbl_lantai_2_annex
CREATE TABLE tbl_lantai_2_annex (
    ruangan NVARCHAR(100) NULL,
    no_panel INT NULL,
    no_kWh_Meter INT NULL,
    nama_kWh_Meter NVARCHAR(100) NULL
);

INSERT INTO tbl_lantai_2_annex (ruangan, no_panel, no_kWh_Meter, nama_kWh_Meter) VALUES
    ('Ruang Panel', 10, 21, 'Panel PD-LT3'),
    ('Ruang Panel', 10, 22, 'Panel P-Kitchen 4');

-- Tabel: tbl_lantai_3
CREATE TABLE tbl_lantai_3 (
    ruangan NVARCHAR(100) NULL,
    no_panel INT NULL,
    no_kWh_Meter INT NULL,
    nama_kWh_Meter NVARCHAR(100) NULL
);

INSERT INTO tbl_lantai_3 (ruangan, no_panel, no_kWh_Meter, nama_kWh_Meter) VALUES
    ('Ruang AHU Podo', 12, 24, 'Panel AHU2-LT3'),
    ('Ruang AHU Yos', 11, 23, 'Panel AHU1-LT3'),
    ('Ruang Panel', 13, 25, 'Panel PP-LT3'),
    ('Ruang Panel', 13, 26, 'Panel LP-LT3');

-- Tabel: tbl_lantai_3_annex
CREATE TABLE tbl_lantai_3_annex (
    ruangan NVARCHAR(100) NULL,
    no_panel INT NULL,
    no_kWh_Meter INT NULL,
    nama_kWh_Meter NVARCHAR(100) NULL
);

INSERT INTO tbl_lantai_3_annex (ruangan, no_panel, no_kWh_Meter, nama_kWh_Meter) VALUES
    ('Ruang Lift 1', 14, 27, 'Panel PP-Lift Service'),
    ('Ruang Lift 2', 15, 28, 'Panel PP-Lift Passenger'),
    ('Ruang Panel', 16, 29, 'Panel PD-LT4'),
    ('Ruang Panel', 16, 30, 'Panel PP-PF');

-- Tabel: tbl_lantai_4
CREATE TABLE tbl_lantai_4 (
    ruangan NVARCHAR(100) NULL,
    no_panel INT NULL,
    no_kWh_Meter INT NULL,
    nama_kWh_Meter NVARCHAR(100) NULL
);

INSERT INTO tbl_lantai_4 (ruangan, no_panel, no_kWh_Meter, nama_kWh_Meter) VALUES
    ('Ruang AHU Podo', 18, 32, 'Panel AHU2-LT4'),
    ('Ruang AHU Yos', 17, 31, 'Panel AHU1-LT4'),
    ('Ruang Panel', 19, 33, 'Panel PP-LT4'),
    ('Ruang Panel', 19, 34, 'Panel LP-LT4');

-- Tabel: tbl_lantai_5
CREATE TABLE tbl_lantai_5 (
    ruangan NVARCHAR(100) NULL,
    no_panel INT NULL,
    no_kWh_Meter INT NULL,
    nama_kWh_Meter NVARCHAR(100) NULL
);

INSERT INTO tbl_lantai_5 (ruangan, no_panel, no_kWh_Meter, nama_kWh_Meter) VALUES
    ('Ruang AHU Podo', 21, 36, 'Panel AHU2-LT5'),
    ('Ruang AHU Podo', 22, 37, 'Panel P-AC Server LT 5'),
    ('Ruang AHU Yos', 20, 35, 'Panel AHU1-LT5'),
    ('Ruang Panel', 23, 38, 'Panel PP-LT5'),
    ('Ruang Panel', 23, 39, 'Panel LP-LT5');

-- Tabel: tbl_lantai_6
CREATE TABLE tbl_lantai_6 (
    ruangan NVARCHAR(100) NULL,
    no_panel INT NULL,
    no_kWh_Meter INT NULL,
    nama_kWh_Meter NVARCHAR(100) NULL
);

INSERT INTO tbl_lantai_6 (ruangan, no_panel, no_kWh_Meter, nama_kWh_Meter) VALUES
    ('Ruang AHU Podo', 25, 41, 'Panel AHU2-LT6'),
    ('Ruang AHU Yos', 24, 40, 'Panel AHU1-LT6'),
    ('Ruang Panel', 26, 42, 'Panel PP-LT6'),
    ('Ruang Panel', 27, 43, 'Panel LP-LT6');

-- Tabel: tbl_lantai_7
CREATE TABLE tbl_lantai_7 (
    ruangan NVARCHAR(100) NULL,
    no_panel INT NULL,
    no_kWh_Meter INT NULL,
    nama_kWh_Meter NVARCHAR(100) NULL
);

INSERT INTO tbl_lantai_7 (ruangan, no_panel, no_kWh_Meter, nama_kWh_Meter) VALUES
    ('Ruang AHU Podo', 29, 45, 'Panel AHU2-LT7'),
    ('Ruang AHU Yos', 28, 44, 'Panel AHU1-LT7'),
    ('Ruang Panel', 30, 46, 'Panel PP-LT7'),
    ('Ruang Panel', 30, 47, 'Panel LP-LT7');
    
    
CREATE TABLE tbl_lantai_8 (
    ruangan NVARCHAR(100) NULL,
    no_panel INT NULL,
    no_kWh_Meter INT NULL,
    nama_kWh_Meter NVARCHAR(100) NULL
);

INSERT INTO tbl_lantai_8 (ruangan, no_panel, no_kWh_Meter, nama_kWh_Meter) VALUES
    ('Ruang Lift', 34, 57, 'Panel P-Lift 1'),
    ('Ruang Lift', 34, 58, 'Panel P-Lift 2'),
    ('Ruang Lift', 34, 59, 'Panel P-Lift 3'),
    ('Ruang Panel', 32, 48, 'Panel P-Chiller 2,3'),
    ('Ruang Panel', 32, 49, 'Panel P-Chiller 1'),
    ('Ruang Panel', 32, 50, 'Panel PP-Roof'),
    ('Ruang Panel', 32, 51, 'Panel LP-Roof'),
    ('Ruang Panel', 32, 52, 'Panel LP-Press Fan'),
    ('Ruang Panel', 33, 53, 'Panel P-Lighting'),
    ('Ruang Panel', 33, 54, 'Panel P-CHWP 1'),
    ('Ruang Panel', 33, 55, 'Panel P-CHWP 2'),
    ('Ruang Panel', 33, 56, 'Panel P-CHWP 3');
CREATE TABLE tbl_lantai_ground (
    ruangan NVARCHAR(100) NULL,
    no_panel INT NULL,
    no_kWh_Meter INT NULL,
    nama_kWh_Meter NVARCHAR(100) NULL
);

INSERT INTO tbl_lantai_ground (ruangan, no_panel, no_kWh_Meter, nama_kWh_Meter) VALUES
    ('Ruang Ground Tank', '6', '14', 'Panel P-Hydrant');


-- untuk LOG
CREATE TABLE "tbl_log_kWh_PP_GL" ( 
    "no_kWh_Meter" INT NULL DEFAULT NULL,
    "nama_kWh_Meter" VARCHAR(MAX),
    "v_avg" VARCHAR(MAX),
    "I_avg" VARCHAR(MAX),
    "PF_avg" VARCHAR(MAX),
    "kVA" VARCHAR(MAX),
    "kW" VARCHAR(MAX),
    "kVArh" VARCHAR(MAX),
    "freq" VARCHAR(MAX),
    "v_L1" VARCHAR(MAX),
    "v_L2" VARCHAR(MAX),
    "v_L3" VARCHAR(MAX),
    "v_12" VARCHAR(MAX),
    "v_23" VARCHAR(MAX),
    "v_31" VARCHAR(MAX),
    "I_A1" VARCHAR(MAX),
    "I_A2" VARCHAR(MAX),
    "I_A3" VARCHAR(MAX),
    "log_waktu" DATETIME NULL DEFAULT NULL
);

SELECT TOP 0 * INTO tbl_log_kWh_LP_GL FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_kWh_LP_GR FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_kWh_AHU1_GL FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_kWh_AHU2_GL FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_kWh_AHU3_GL FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_kWh_AHU4_GL FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_kWh_PLTS FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_Power_Quality_LVMDP FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_kWhP_Outgoing FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_kWh_SDP_B FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_Panel_PD_LT_1 FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_Panel_PD_MZ FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_Panel_P_Hydrant FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_Panel_AHU2_LT2 FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_Panel_AHU1_LT2 FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_Panel_PP_LT2 FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_Panel_LP_LT2 FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_Panel_LP_MEZ FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_P_Electronic FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_Panel_PD_LT3 FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_Panel_P_Kitchen_4 FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_Panel_AHU1_LT3 FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_Panel_AHU2_LT3 FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_Panel_PP_LT3 FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_Panel_LP_LT3 FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_Panel_PP_Lift_Service FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_Panel_PP_Lift_Passenger FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_Panel_PD_LT4 FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_Panel_PP_PF FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_Panel_AHU1_LT4 FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_Panel_AHU2_LT4 FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_Panel_PP_LT4 FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_Panel_LP_LT4 FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_Panel_AHU1_LT5 FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_Panel_AHU2_LT5 FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_Panel_P_AC_Server_LT_5 FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_Panel_PP_LT5 FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_Panel_LP_LT5 FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_Panel_AHU1_LT6 FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_Panel_AHU2_LT6 FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_Panel_PP_LT6 FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_Panel_LP_LT6 FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_Panel_AHU1_LT7 FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_Panel_AHU2_LT7 FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_Panel_PP_LT7 FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_Panel_LP_LT7 FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_Panel_P_Chiller_2_3 FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_Panel_P_Chiller_1 FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_Panel_PP_Roof FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_Panel_LP_Roof FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_Panel_LP_Press_Fan FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_Panel_P_Lighting FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_Panel_P_CHWP_1 FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_Panel_P_CHWP_2 FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_Panel_P_CHWP_3 FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_Panel_P_Lift_1 FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_Panel_P_Lift_2 FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_Panel_P_Lift_3 FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_Panel_Genset FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_Panel_P_Carpool FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_Panel_P_Koperasi FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_Panel_P_Transfer_Pump FROM tbl_log_kWh_PP_GL;
SELECT TOP 0 * INTO tbl_log_Panel_P_STP FROM tbl_log_kWh_PP_GL;



-- Buat tabel "users" jika belum ada
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='users' AND xtype='U')
CREATE TABLE users (
	[id] INT IDENTITY(1,1) NOT NULL, -- IDENTITY(1,1) membuat kolom 'id' auto increment
	[nama] VARCHAR(100) NOT NULL,
	[no_hp] VARCHAR(15) NOT NULL,
	[email] VARCHAR(255) NOT NULL,
	[email_verified_at] DATETIME NULL DEFAULT NULL, -- Kolom dari gambar
	[password] VARCHAR(255) NOT NULL,
	[remember_token] VARCHAR(255) NULL DEFAULT NULL, -- Kolom dari gambar
	[role] VARCHAR(50) NULL DEFAULT NULL,
	[verify_at] DATETIME NULL DEFAULT NULL,
	[otp] NVARCHAR(6) NULL DEFAULT NULL,
	[otp_expires_at] DATETIME NULL DEFAULT NULL,
	[created_at] DATETIME NOT NULL DEFAULT GETDATE(),
	[updated_at] DATETIME NOT NULL DEFAULT GETDATE(),
	PRIMARY KEY ([id]),
	UNIQUE ([email]),
	UNIQUE ([no_hp])
);

-- Masukkan data awal ke dalam tabel "users"
SET IDENTITY_INSERT users ON;

INSERT INTO users ([id], [nama], [no_hp], [email], [email_verified_at], [password], [remember_token], [role], [verify_at], [otp], [otp_expires_at], [created_at], [updated_at])
VALUES
    (1, 'Rendy', '+628996685192', 'arendy724@gmail.com', NULL, '$2y$10$IxXLKXN9pTSrxmrCVZsPverom.hXgXTNyvepyl5DL14cbe4bIYjxK', NULL, 'management', '2024-11-21 11:31:33.003', '823284', '2024-11-21 11:42:41.860', '2024-11-21 10:45:37.133', '2024-11-24 13:02:09.247'),
    (2, 'Javier Jibran', '+621930198310', 'javierjibran3@gmail.com', NULL, '$2y$10$mbTUe1FC6ba5bVpvTM.4oO8hUL.kTDHFyqmU6TMrrhYa2c4VOtJP6', NULL, 'operator', '2024-11-21 13:56:45.077', NULL, NULL, '2024-11-21 13:56:19.123', '2024-11-22 10:36:00.977');

SET IDENTITY_INSERT users OFF;

-- Tabel management Log
CREATE TABLE tbl_Managementlog_perJam (
    totalPLNKWH NVARCHAR(255) NOT NULL,
	totalPanelKWH NVARCHAR(255) NOT NULL,
	totalPVKWH NVARCHAR(255) NOT NULL,
    totalPLNCost NVARCHAR(255) NOT NULL,
    totalPVIncome NVARCHAR(255) NOT NULL,
    RECexpe NVARCHAR(255) NOT NULL,
    EmisiPLN NVARCHAR(255) NOT NULL,
    EEI NVARCHAR(255) NOT NULL,
    log_waktu NVARCHAR(255) NOT NULL
);

CREATE TABLE tbl_Managementlog_perHari (
    totalPLNKWH NVARCHAR(255) NOT NULL,
	totalPanelKWH NVARCHAR(255) NOT NULL,
	totalPVKWH NVARCHAR(255) NOT NULL,
    totalPLNCost NVARCHAR(255) NOT NULL,
    totalPVIncome NVARCHAR(255) NOT NULL,
    RECexpe NVARCHAR(255) NOT NULL,
    EmisiPLN NVARCHAR(255) NOT NULL,
    EEI NVARCHAR(255) NOT NULL,
    log_waktu NVARCHAR(255) NOT NULL
);

CREATE TABLE tbl_Managementlog_perBulan (
    totalPLNKWH NVARCHAR(255) NOT NULL,
	totalPanelKWH NVARCHAR(255) NOT NULL,
	totalPVKWH NVARCHAR(255) NOT NULL,
    totalPLNCost NVARCHAR(255) NOT NULL,
    totalPVIncome NVARCHAR(255) NOT NULL,
    RECexpe NVARCHAR(255) NOT NULL,
    EmisiPLN NVARCHAR(255) NOT NULL,
    EEI NVARCHAR(255) NOT NULL,
    log_waktu NVARCHAR(255) NOT NULL
);

CREATE TABLE tbl_Managementlog_perTahun (
    totalPLNKWH NVARCHAR(255) NOT NULL,
	totalPanelKWH NVARCHAR(255) NOT NULL,
	totalPVKWH NVARCHAR(255) NOT NULL,
    totalPLNCost NVARCHAR(255) NOT NULL,
    totalPVIncome NVARCHAR(255) NOT NULL,
    RECexpe NVARCHAR(255) NOT NULL,
    EmisiPLN NVARCHAR(255) NOT NULL,
    EEI NVARCHAR(255) NOT NULL,
    log_waktu NVARCHAR(255) NOT NULL
);


-- Tabel tbl_set_value
CREATE TABLE tbl_set_value (
    id INT PRIMARY KEY IDENTITY(1,1),
    lbwp NVARCHAR(255) NOT NULL,
    wbp NVARCHAR(255) NOT NULL,
    kvarh NVARCHAR(255) NOT NULL,
    emission_factor NVARCHAR(255) NOT NULL,
    total_cost_limit NVARCHAR(255) NOT NULL,
    created_at DATETIME DEFAULT GETDATE(),
    updated_at DATETIME DEFAULT GETDATE()
);

-- Tabel tbl_set_value_log
CREATE TABLE tbl_set_value_log (
    id INT PRIMARY KEY IDENTITY(1,1),
    users_id INT NOT NULL,
    old_lbwp NVARCHAR(255),
    old_wbp NVARCHAR(255),
    old_kvarh NVARCHAR(255),
    old_emission_factor NVARCHAR(255),
    old_total_cost_limit NVARCHAR(255),
    new_lbwp NVARCHAR(255),
    new_wbp NVARCHAR(255),
    new_kvarh NVARCHAR(255),
    new_emission_factor NVARCHAR(255),
    new_total_cost_limit NVARCHAR(255),
    created_at DATETIME DEFAULT GETDATE(),
    updated_at DATETIME DEFAULT GETDATE(),
    FOREIGN KEY (users_id) REFERENCES users(id)
);

INSERT INTO tbl_set_value (lbwp, wbp, kvarh, emission_factor, total_cost_limit)
VALUES ('1035.78', '1553.67', '1114.78', '0.85', '524000000');