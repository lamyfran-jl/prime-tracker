const { google } = require("googleapis");
const { Readable } = require("stream");

const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;

function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive",
    ],
  });
}

function bufferToStream(buffer) {
  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);
  return stream;
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
    const { sheet_name, row_index, file_name, file_data, mime_type } = body;

    if (!file_data || !file_name || !sheet_name || row_index === undefined) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Paramètres manquants" }) };
    }

    const auth = getAuth();
    const drive = google.drive({ version: "v3", auth });
    const sheets = google.sheets({ version: "v4", auth });

    const fileBuffer = Buffer.from(file_data, "base64");

    // Upload dans l'espace du Service Account (pas de parents = quota illimité)
    const driveRes = await drive.files.create({
      requestBody: {
        name: file_name,
        // Pas de 'parents' — stocké dans l'espace propre du Service Account
      },
      media: {
        mimeType: mime_type || "application/pdf",
        body: bufferToStream(fileBuffer),
      },
      fields: "id, webViewLink",
    });

    const fileId = driveRes.data.id;
    const viewLink = driveRes.data.webViewLink;

    // Rendre le fichier accessible à toute personne ayant le lien
    await drive.permissions.create({
      fileId,
      requestBody: { role: "reader", type: "anyone" },
    });

    // Sauvegarder le lien dans la colonne J du Sheets
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${sheet_name}'!J${row_index + 1}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[viewLink]] },
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, file_id: fileId, view_link: viewLink }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
