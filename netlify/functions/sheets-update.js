const { google } = require("googleapis");

const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;

function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

const COL_MAP = {
  designation: 0,    // A
  qty: 1,            // B
  prix_ht: 2,        // C
  prix_ttc: 3,       // D
  total_ht: 4,       // E
  total_ttc: 5,      // F
  fournisseur: 6,    // G
  statut: 7,         // H
  date_livraison: 8, // I
};

function colLetter(idx) {
  return String.fromCharCode(65 + idx);
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  try {
    const body = JSON.parse(event.body);
    const auth = getAuth();
    const sheets = google.sheets({ version: "v4", auth });

    // ── ADD ROW ──
    if (body.action === "add_row") {
      const { sheet_name, after_row_index, row_data } = body;
      // after_row_index is 0-based content row; +2 because sheets are 1-based and we insert AFTER
      const insertAt = after_row_index + 2;

      // Insert a blank row
      const sheetMeta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
      const sheetObj = sheetMeta.data.sheets.find(s => s.properties.title === sheet_name);
      if (!sheetObj) return { statusCode: 404, headers, body: JSON.stringify({ error: "Sheet not found" }) };
      const sheetId = sheetObj.properties.sheetId;

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          requests: [{
            insertDimension: {
              range: { sheetId, dimension: "ROWS", startIndex: insertAt - 1, endIndex: insertAt },
              inheritFromBefore: true,
            }
          }]
        }
      });

      // Write the new row data
      const values = [
        row_data.designation || "",
        row_data.qty || "",
        row_data.prix_ht || "",
        row_data.prix_ttc || "",
        row_data.total_ht || "",
        row_data.total_ttc || "",
        row_data.fournisseur || "",
        row_data.statut || "En attente",
        row_data.date_livraison || "",
      ];

      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${sheet_name}'!A${insertAt}:I${insertAt}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [values] },
      });

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, inserted_at: insertAt }) };
    }

    // ── UPDATE CELL ──
    const { sheet_name, row_index, field, value } = body;

    if (!sheet_name || row_index === undefined || !field) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing parameters" }) };
    }

    const colIdx = COL_MAP[field];
    if (colIdx === undefined) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: `Unknown field: ${field}` }) };
    }

    const range = `'${sheet_name}'!${colLetter(colIdx)}${row_index + 1}`;

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[value]] },
    });

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, range, value }) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
