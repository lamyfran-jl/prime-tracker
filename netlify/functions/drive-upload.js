const { google } = require("googleapis");
const { Readable } = require("stream");

const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;
const FOLDER_ID = "1ZqXGLzcLZaiRmAW_gUsKPjWiCQXG21hK";

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

    // Convert base64 to buffer
    const fileBuffer = Buffer.from(file_data, "base64");

    // Upload to Drive
    const driveRes = await drive.files.create({
      requestBody: {
        name: file_name,
        parents: [FOLDER_ID],
      },
      media: {
        mimeType: mime_type || "application/pdf",
        body: bufferToStream(fileBuffer),
      },
      fields: "id, webViewLink, webContentLink",
    });

    const fileId = driveRes.data.id;
    const viewLink = driveRes.data.webViewLink;

    // Make file readable by anyone with the link
    await drive.permissions.create({
      fileId,
      requestBody: { role: "reader", type: "anyone" },
    });

    // Write the Drive link into column J of the Sheets row
    const range = `'${sheet_name}'!J${row_index + 1}`;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range,
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
