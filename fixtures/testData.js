import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const TD = path.join(ROOT, "test-data");

/**
 * Central registry of test-data paths mapped to Excel "Test Data Needed" IDs.
 * Paths match the filenames visible in the user's Explorer screenshots.
 */
export const TestData = {
  // --- TD-01 / TD-03 / TD-04 — small valid georeferenced ---
  validSid: path.join(TD, "valid", "01_NAIP_2014_WGS84.sid"),
  validSidEpsg: path.join(TD, "valid", "NAIP_2014_WGS84_EPSG4326.sid"),
  validTif: path.join(TD, "valid", "02_NAIP_2014_WGS84.tif"),
  validGeoTif: path.join(TD, "valid", "Valid_GeoTIF.tif"),
  validTiff: path.join(TD, "valid", "Valid_GeoTIFF.tiff"),
  validUtmTif: path.join(TD, "valid", "03_NAIP_companion_UTM17N.tif"),
  sampleOsgeoBrit: path.join(TD, "valid", "sample_osgeo_brit.tif"),
  sampleOsgeoGeog: path.join(TD, "valid", "sample_osgeo_geog.tif"),
  sampleOsgeoPci: path.join(TD, "valid", "sample_osgeo_pci.tif"),

  // --- TD-05 — large files (1–1.5 GB, @large-file only) ---
  large1GB: path.join(TD, "valid", "large_1GB_MrSID.sid"),
  large1_3GB: path.join(TD, "valid", "large_1.3GB_MrSID_alaska_eox_007of016.sid"),
  large1_69GB: path.join(TD, "valid", "S1A_Ireland_Complex_Mosaic_May2015_20m_EPSG2157_1.69GB.tif"),

  // --- TD-21 — multi-file set ---
  multiFile0: path.join(TD, "valid", "01_multi_file_set_0_0.tif"),
  multiFile1: path.join(TD, "valid", "01_multi_file_set_1_1.sid"),
  multiFile2: path.join(TD, "valid", "01_multi_file_set_2_0.tif"),

  // --- TD-06 / TD-07 — non-georeferenced ---
  nonGeorefSid: path.join(TD, "invalid", "non_georeferenced.sid"),
  nonGeorefTif: path.join(TD, "invalid", "non_georeferenced.tif"),
  nonGeorefTiff: path.join(TD, "invalid", "non_georeferenced.tiff"),

  // --- TD-08 — corrupt ---
  corruptSid: path.join(TD, "corrupt", "corrupt.sid"),
  corruptTif: path.join(TD, "corrupt", "corrupt.tif"),

  // --- TD-09 / TD-10 — boundary empty / tiny ---
  emptyTif: path.join(TD, "boundary", "empty.tif"),
  tinySid: path.join(TD, "boundary", "tiny.sid"),

  // --- TD-12 — UPPERCASE extensions ---
  upperSid: path.join(TD, "boundary", "VALID_UPPER_MrSID_Extension.SID"),
  upperTif: path.join(TD, "boundary", "VALID_UPPER_TIF_Extension.TIF"),

  // --- TD-15 — special-char names ---
  specialSpaces: path.join(TD, "boundary", "file with spaces.tif"),
  specialHashAmp: path.join(TD, "boundary", "file_with_spaces_hash_amp_pct_plus.tif"),

  // --- TD-16 — same filename different folders ---
  sharedNameA: path.join(TD, "boundary", "folder_a", "shared_name.tif"),
  sharedNameB: path.join(TD, "boundary", "folder_b", "shared_name.tif"),

  // --- TD-11 / TD-11b / TD-13 — negative / deceptive ---
  fakeGif: path.join(TD, "negative", "fake.gif"),
  fakeJpg: path.join(TD, "negative", "fake.jpg"),
  fakePng: path.join(TD, "negative", "fake.png"),
  fakePdf: path.join(TD, "negative", "fake.pdf"),
  fakeTxt: path.join(TD, "negative", "fake.txt"),
  fakeZip: path.join(TD, "negative", "fake.zip"),
  noExt: path.join(TD, "negative", "rasterfile"),
  deceptiveSidTxt: path.join(TD, "negative", "image.sid.txt"),
  deceptiveTifExe: path.join(TD, "negative", "image.tif.exe"),
  deceptiveTxtTif: path.join(TD, "negative", "image.txt.tif"),

  // --- TD-17..20 — GIS edge cases ---
  // Use west + east as separate TCs (pacific removed from test-data/gis)
  antimeridianWest: path.join(TD, "gis", "antimeridian_west.tif"),
  antimeridianEast: path.join(TD, "gis", "antimeridian_east.tif"),
  swHemisphere: path.join(TD, "gis", "sw_hemisphere_satellite.tif"),
  tinyMetres: path.join(TD, "gis", "tiny_metres_raster.tif"),
  rotatedNaip: path.join(TD, "gis", "rotated_naip_satellite.tif"),

  sparse11gbA: path.join(TD, "boundary", "sparse_11gb_a_marker.tif"),
  sparse11gbB: path.join(TD, "boundary", "sparse_11gb_b_marker.tif"),
  sparse20gb: path.join(TD, "boundary", "sparse_20gb_marker.tif"),
  sparse20gbPlus: path.join(TD, "boundary", "sparse_20gb_plus1_marker.tif"),
};

export function firstExisting(...candidates) {
  for (const p of candidates) {
    if (hasFixture(p)) return p;
  }
  return null;
}

export function pickValidSid() {
  return firstExisting(
    TestData.validSid,
    TestData.validSidEpsg,
    TestData.multiFile1,
    TestData.upperSid
  );
}

export function pickValidTif() {
  return firstExisting(
    TestData.validTif,
    TestData.validGeoTif,
    TestData.sampleOsgeoGeog,
    TestData.sampleOsgeoPci,
    TestData.sampleOsgeoBrit,
    TestData.multiFile0,
    TestData.upperTif,
    TestData.rotatedNaip,
    TestData.swHemisphere
  );
}

export function pickValidRaster() {
  return pickValidSid() || pickValidTif();
}

export function hasFixture(filePath) {
  try {
    const st = fs.statSync(filePath);
    return st.isFile() && st.size > 0;
  } catch {
    return false;
  }
}

export function requireFixture(filePath, testInfo) {
  if (hasFixture(filePath)) return true;
  testInfo.skip(true, `Missing fixture: ${path.relative(ROOT, filePath)}`);
  return false;
}

export function listBoundaryUnicode() {
  const dir = path.join(TD, "boundary");
  try {
    return fs
      .readdirSync(dir)
      .filter((n) => /\.(tif|tiff|sid)$/i.test(n))
      .filter((n) => /[^\x00-\x7F]/.test(n) || /acentos/i.test(n))
      .map((n) => path.join(dir, n));
  } catch {
    return [];
  }
}

export const SUPPORTED_EXTENSIONS = [".sid", ".tif", ".tiff"];
export const UNSUPPORTED_EXTENSIONS = [".gif", ".jpg", ".png", ".pdf", ".txt", ".zip"];

export const UI_STRINGS = {
  dropTitle: "Drop Imagery File",
  dropSupport: "Support for .SID, .TIF, .TIFF",
  systemReady: "System Ready",
  extracting: "EXTRACTING GEODATA",
  pleaseWait: "PLEASE WAIT...",
  analysisComplete: "Analysis Complete",
  allFilesProcessed: "All files processed!",
  onlySupported: "Only .sid, .tif, and .tiff files are supported.",
  noGeoref:
    "This file does not contain georeferencing metadata. Please upload a valid georeferenced image.",
  noGeorefShort: "does not contain georeferencing",
  viewOnMap: "VIEW ON MAP",
  clear: "CLEAR",
  processedPrefix: "PROCESSED",
  checkingCache: "Checking Local Cache",
  foundLocally: "Found locally",
};
