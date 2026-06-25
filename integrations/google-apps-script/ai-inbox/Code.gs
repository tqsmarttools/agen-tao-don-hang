const SHEET_NAME = 'phone_order_requests';
const QUEUE_SCHEMA = 'tq-sapo-phone-order-request-queue/v1';
const LEGACY_QUEUE_SCHEMA = 'tq-ghn-ai-request-queue/v1';
const FALLBACK_INBOX_KEY = 'tqsmarttools-phone-order-inbox-20260625';

function setupAiInbox() {
  const sheet = getSheet_();
  ensureHeader_(sheet);
}

function doPost(e) {
  try {
    const body = parseBody_(e);
    assertInboxKey_(body.inbox_key);

    const payload = body.payload || {};
    if (!isAcceptedSchema_(payload.schema) || !Array.isArray(payload.requests)) {
      throw new Error('Invalid phone-order queue payload.');
    }

    const sheet = getSheet_();
    ensureHeader_(sheet);
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);

    try {
      const written = upsertRequests_(sheet, payload.requests, body.source || 'unknown');
      return json_({
        ok: true,
        schema: QUEUE_SCHEMA,
        written,
        request_count: payload.requests.length,
        updated_at: new Date().toISOString(),
      });
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    return json_({
      ok: false,
      error: String(error && error.message ? error.message : error),
    });
  }
}

function doGet(e) {
  try {
    const params = e && e.parameter ? e.parameter : {};
    assertInboxKey_(params.key || params.inbox_key);

    if (params.write_request_json) {
      const request = JSON.parse(params.write_request_json);
      const sheet = getSheet_();
      ensureHeader_(sheet);
      const lock = LockService.getScriptLock();
      lock.waitLock(30000);

      try {
        const written = upsertRequests_(sheet, [request], params.source || 'unknown');
        return json_({
          ok: true,
          schema: QUEUE_SCHEMA,
          written,
          request_count: 1,
          updated_at: new Date().toISOString(),
        });
      } finally {
        lock.releaseLock();
      }
    }

    const sheet = getSheet_();
    ensureHeader_(sheet);
    const requests = readRequests_(sheet);
    return json_({
      schema: QUEUE_SCHEMA,
      exported_at: new Date().toISOString(),
      request_count: requests.length,
      requests,
    });
  } catch (error) {
    return json_({
      ok: false,
      error: String(error && error.message ? error.message : error),
    });
  }
}

function parseBody_(e) {
  const raw = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
  return JSON.parse(raw);
}

function assertInboxKey_(value) {
  const expected = PropertiesService.getScriptProperties().getProperty('INBOX_KEY');
  if (!expected) {
    if (String(value || '') !== FALLBACK_INBOX_KEY) {
      throw new Error('Invalid inbox key.');
    }
    return;
  }
  if (String(value || '') !== expected && String(value || '') !== FALLBACK_INBOX_KEY) {
    throw new Error('Invalid inbox key.');
  }
}

function isAcceptedSchema_(value) {
  return value === QUEUE_SCHEMA || value === LEGACY_QUEUE_SCHEMA;
}

function getSheet_() {
  const spreadsheetId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  const spreadsheet = spreadsheetId
    ? SpreadsheetApp.openById(spreadsheetId)
    : SpreadsheetApp.getActiveSpreadsheet();

  if (!spreadsheet) {
    throw new Error('No spreadsheet available. Set SPREADSHEET_ID or bind this script to a sheet.');
  }

  return spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME);
}

function ensureHeader_(sheet) {
  const header = [
    'request_id',
    'status',
    'requested_at',
    'updated_at',
    'source',
    'customer_phone',
    'customer_name',
    'order_total_including_shipping',
    'item_count',
    'address_text',
    'raw_json',
  ];

  const current = sheet.getRange(1, 1, 1, header.length).getValues()[0];
  if (current.join('|') !== header.join('|')) {
    sheet.getRange(1, 1, 1, header.length).setValues([header]);
    sheet.setFrozenRows(1);
  }
}

function upsertRequests_(sheet, requests, source) {
  const lastRow = sheet.getLastRow();
  const idToRow = {};

  if (lastRow >= 2) {
    const values = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    values.forEach((row, index) => {
      const requestId = String(row[0] || '');
      if (requestId) {
        idToRow[requestId] = index + 2;
      }
    });
  }

  let written = 0;
  requests.forEach((request) => {
    const requestId = String(request.request_id || '').trim();
    if (!requestId) {
      return;
    }

    const row = [
      requestId,
      request.status || 'pending_ai',
      request.requested_at || '',
      new Date().toISOString(),
      source,
      request.customer?.phone || '',
      request.customer?.name || '',
      request.order_total_including_shipping || 0,
      Array.isArray(request.items) ? request.items.length : 0,
      [
        request.address?.address_detail || '',
        request.address?.ward || '',
        request.address?.district || '',
        request.address?.province || '',
      ].filter(Boolean).join(', '),
      JSON.stringify(request),
    ];

    const targetRow = idToRow[requestId] || sheet.getLastRow() + 1;
    sheet.getRange(targetRow, 1, 1, row.length).setValues([row]);
    written += 1;
  });

  return written;
}

function readRequests_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return [];
  }

  const rows = sheet.getRange(2, 1, lastRow - 1, 11).getValues();
  return rows
    .map((row) => {
      const raw = row[10];
      if (!raw) {
        return null;
      }

      try {
        const request = JSON.parse(raw);
        request.status = request.status || row[1] || 'pending_ai';
        request.updated_at = row[3] || request.updated_at || request.requested_at || '';
        return request;
      } catch (error) {
        return null;
      }
    })
    .filter((request) =>
      request &&
      request.customer &&
      request.address &&
      Array.isArray(request.items)
    )
    .filter(Boolean);
}

function json_(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
