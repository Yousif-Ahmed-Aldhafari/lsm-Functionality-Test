const path = require("path");
const { CSV_COLUMNS, validateCsvFile } = require("./lsm-report-generator.cjs");

const resultsDir = path.join(process.cwd(), "cypress", "results");
const files = [
  "LSM_All_Test_Cases.csv",
  "LSM_Automated_Test_Cases.csv",
  "LSM_Manual_Test_Cases.csv",
];

let ok = true;

for (const fileName of files) {
  const result = validateCsvFile(path.join(resultsDir, fileName), CSV_COLUMNS);
  if (!result.ok) {
    ok = false;
  }
  console.log(
    `${fileName}: rows=${result.rowCount}, columns=${result.columnCount}, uniqueTCIDs=${result.tcIdCount}, multilineSteps=${result.hasMultilineSteps}, arabic=${result.hasArabic}, ok=${result.ok}`,
  );
  for (const error of result.errors) {
    console.error(`  - ${error}`);
  }
}

process.exit(ok ? 0 : 1);
