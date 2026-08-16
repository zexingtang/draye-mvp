/**
 * 生成给客户的 Onboarding 表格（一次性脚本，不是 API）。
 * 用法：npm run gen:onboarding
 * 输出：docs/onboarding-form-v2.xlsx —— 这份文件是发给客户填的，填完拿回来手动配置系统。
 *
 * v2：合并成一个 sheet（客户反馈多个 tab 不友好），每一步给简短提示。Custom Columns
 * 表格把"选 Field Type"这种抽象概念换成了"举个例子"+ 一个单独的 Yes/No"是否可复用"下拉。
 * 改动记录（同一个 v2 文件里迭代，没有另开 v3）：
 *   - 行高统一调大，不用客户自己拉
 *   - Company Info 里 username 后面加一个 Password 字段（跟 email 无关，纯自由文本）
 *   - Custom Columns 表格去掉"起始选项值"这一列——可复用列表的具体值客户登录后自己加，
 *     onboarding 阶段只需要知道"这一列是不是可复用列表"，不需要预先收集值
 *   - 空白行从 20 行加到 40 行
 */
import ExcelJS from 'exceljs';
import path from 'path';

const NAVY = 'FF1E293B';
const WHITE = 'FFFFFFFF';
const SECTION_BG = 'FFDBEAFE';
const SECTION_TEXT = 'FF1E3A8A';
const EXAMPLE_BG = 'FFFEF3C7';
const EXAMPLE_TEXT = 'FF92400E';
const HINT_TEXT = 'FF64748B';

function sectionHeader(cell: ExcelJS.Cell, text: string) {
  cell.value = text;
  cell.font = { bold: true, size: 13, color: { argb: SECTION_TEXT } };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SECTION_BG } };
  cell.alignment = { vertical: 'middle', indent: 1 };
}

function hint(cell: ExcelJS.Cell, text: string) {
  cell.value = text;
  cell.font = { italic: true, size: 10, color: { argb: HINT_TEXT } };
  cell.alignment = { wrapText: true, vertical: 'top' };
}

function label(cell: ExcelJS.Cell, text: string) {
  cell.value = text;
  cell.font = { bold: true, size: 11 };
  cell.alignment = { wrapText: true, vertical: 'middle' };
}

function inputBorder(cell: ExcelJS.Cell) {
  cell.border = {
    top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
    left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
    bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
    right: { style: 'thin', color: { argb: 'FFD1D5DB' } },
  };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
  cell.alignment = { wrapText: true, vertical: 'middle' };
}

function yesNoDropdown(cell: ExcelJS.Cell) {
  cell.dataValidation = {
    type: 'list',
    allowBlank: true,
    formulae: ['"Yes,No"'],
    showErrorMessage: true,
    errorTitle: 'Invalid choice',
    error: 'Please pick "Yes" or "No" from the dropdown.',
  };
}

async function main() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Draye';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Onboarding');
  const widths = [34, 32, 24, 24, 20];
  ['A', 'B', 'C', 'D', 'E'].forEach((col, i) => (sheet.getColumn(col).width = widths[i]));

  let row = 1;
  const next = (n = 1) => {
    row += n;
    return row;
  };

  // ---------------------------------------------------------------------
  // Title
  // ---------------------------------------------------------------------
  sheet.getCell(`A${row}`).value = 'Draye — Setup Form';
  sheet.getCell(`A${row}`).font = { size: 18, bold: true, color: { argb: NAVY } };
  sheet.getRow(row).height = 26;
  next();
  sheet.getCell(`A${row}`).value =
    'Fill in the fields below (about 5 minutes), save the file, and send it back — we will use it to set up your account.';
  sheet.mergeCells(`A${row}:E${row}`);
  sheet.getCell(`A${row}`).font = { italic: true, size: 11 };
  sheet.getCell(`A${row}`).alignment = { wrapText: true };
  sheet.getRow(row).height = 28;
  next(2);

  // ---------------------------------------------------------------------
  // Step 1: Company Info
  // ---------------------------------------------------------------------
  sheet.mergeCells(`A${row}:E${row}`);
  sectionHeader(sheet.getCell(`A${row}`), 'Step 1 — Company Info');
  sheet.getRow(row).height = 24;
  next();

  const companyFields: [string, string | null, number?][] = [
    ['Company Name', null],
    ['How many people need their own login?', 'Enter a number — 1 is fine if everyone shares one login.'],
    ['Preferred username(s)', 'One per line if more than one, e.g. an email address per person.', 60],
    ['Password', "Doesn't need to be related to your email — just something you'll remember. One per line, matching the usernames above.", 60],
  ];
  for (const [text, hintText, rowHeight] of companyFields) {
    label(sheet.getCell(`A${row}`), text);
    sheet.mergeCells(`B${row}:E${row}`);
    inputBorder(sheet.getCell(`B${row}`));
    sheet.getRow(row).height = rowHeight ?? 26;
    next();
    if (hintText) {
      sheet.mergeCells(`A${row}:E${row}`);
      hint(sheet.getCell(`A${row}`), hintText);
      sheet.getRow(row).height = 26;
      next();
    }
  }
  next();

  // ---------------------------------------------------------------------
  // Step 2: Tracking Setup
  // ---------------------------------------------------------------------
  sheet.mergeCells(`A${row}:E${row}`);
  sectionHeader(sheet.getCell(`A${row}`), 'Step 2 — Tracking Setup');
  sheet.getRow(row).height = 24;
  next();

  label(sheet.getCell(`A${row}`), 'Which railroad(s) do you need tracked?');
  sheet.mergeCells(`B${row}:E${row}`);
  inputBorder(sheet.getCell(`B${row}`));
  sheet.getCell(`B${row}`).dataValidation = {
    type: 'list',
    allowBlank: true,
    formulae: ['"BNSF,Other (write it in the cell)"'],
    showErrorMessage: true,
    errorTitle: 'Invalid choice',
    error: 'Please pick from the dropdown list.',
  };
  sheet.getRow(row).height = 26;
  next();
  sheet.mergeCells(`A${row}:E${row}`);
  hint(sheet.getCell(`A${row}`), 'Currently only BNSF is supported. If you need another railroad, pick "Other" and tell us which one.');
  sheet.getRow(row).height = 26;
  next(2);

  // ---------------------------------------------------------------------
  // Step 3: Custom Columns
  // ---------------------------------------------------------------------
  sheet.mergeCells(`A${row}:E${row}`);
  sectionHeader(sheet.getCell(`A${row}`), 'Step 3 — Custom Columns');
  sheet.getRow(row).height = 24;
  next();

  sheet.mergeCells(`A${row}:E${row}`);
  hint(
    sheet.getCell(`A${row}`),
    'These columns are already built in — do not list them: Container #, Carrier, Status, ETA Date, ETA Time, LFD, Last Updated. ' +
      'They are filled in automatically by our tracking system and cannot be edited by hand.'
  );
  sheet.getRow(row).height = 32;
  next();
  sheet.mergeCells(`A${row}:E${row}`);
  hint(
    sheet.getCell(`A${row}`),
    '"Reusable List" means a fixed set of values you will pick from again and again — like your regular Freight Forwarders. ' +
      'You do not need to list the actual values here — once you are logged in, you can add or remove list items yourself, anytime.'
  );
  sheet.getRow(row).height = 32;
  next(1);

  const headerRow = row;
  const headers = ['Column Name', 'Field Example', 'Reusable List? (Yes/No)', 'Show by default? (Yes/No)'];
  headers.forEach((h, i) => {
    const cell = sheet.getCell(headerRow, i + 1);
    cell.value = h;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    cell.font = { bold: true, size: 10.5, color: { argb: WHITE } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  sheet.getRow(headerRow).height = 30;
  next();

  interface ExampleRow {
    name: string;
    example: string;
    reusable: string;
    visible: string;
  }
  const examples: ExampleRow[] = [
    { name: 'PO Number', example: 'PO-48213', reusable: 'No', visible: 'Yes' },
    { name: 'Freight Forwarder', example: 'ABC Logistics', reusable: 'Yes', visible: 'Yes' },
    { name: 'Consignee', example: 'Consignee A', reusable: 'Yes', visible: 'No' },
    { name: 'Notes', example: 'Fragile, handle with care', reusable: 'No', visible: 'No' },
  ];

  examples.forEach((ex) => {
    sheet.getCell(row, 1).value = `EXAMPLE — ${ex.name}`;
    sheet.getCell(row, 2).value = ex.example;
    sheet.getCell(row, 3).value = ex.reusable;
    sheet.getCell(row, 4).value = ex.visible;
    sheet.getRow(row).height = 20;
    for (let c = 1; c <= 4; c++) {
      const cell = sheet.getCell(row, c);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EXAMPLE_BG } };
      cell.font = { italic: true, size: 10, color: { argb: EXAMPLE_TEXT } };
      cell.alignment = { vertical: 'middle', wrapText: true };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        right: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      };
    }
    next();
  });

  const blankRows = 40;
  for (let i = 0; i < blankRows; i++) {
    sheet.getRow(row).height = 20;
    for (let c = 1; c <= 4; c++) inputBorder(sheet.getCell(row, c));
    yesNoDropdown(sheet.getCell(row, 3));
    yesNoDropdown(sheet.getCell(row, 4));
    next();
  }

  sheet.views = [{ state: 'frozen', ySplit: headerRow }];

  const outPath = path.join(process.cwd(), 'docs', 'onboarding-form-v2.xlsx');
  await workbook.xlsx.writeFile(outPath);
  console.log('Written to', outPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
