using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace LicenseManager;

public partial class Form1 : Form
{
    private const string Product = "商品生图助手";
    private readonly string dataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "StoreAssistantIssuer");
    private readonly string keyFile;
    private readonly string recordsFile;
    private ECDsa? signingKey;
    private List<LicenseRecord> records = new();
    private TextBox customerBox = null!, machineBox = null!, licenseIdBox = null!, companyBox = null!, contactBox = null!, notesBox = null!, outputBox = null!;
    private DateTimePicker expiryPicker = null!;
    private Label keyStatus = null!, resultStatus = null!;
    private DataGridView grid = null!;

    public Form1()
    {
        keyFile = Path.Combine(dataDir, "private-key.dpapi");
        recordsFile = Path.Combine(dataDir, "licenses.json");
        InitializeComponent();
        BuildUi();
        LoadRecords();
        LoadProtectedKey();
    }

    private void BuildUi()
    {
        Text = "商品生图助手 · 离线激活码发行管理";
        StartPosition = FormStartPosition.CenterScreen; MinimumSize = new Size(1080, 700);
        Font = new Font("Microsoft YaHei UI", 9F);
        var root = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 3, Padding = new Padding(14) };
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 68)); root.RowStyles.Add(new RowStyle(SizeType.Absolute, 270)); root.RowStyles.Add(new RowStyle(SizeType.Percent, 100)); Controls.Add(root);
        var header = new Panel { Dock = DockStyle.Fill, BackColor = Color.FromArgb(232, 244, 255) };
        header.Controls.Add(new Label { Text = "离线激活码发行管理", Font = new Font(Font.FontFamily, 19, FontStyle.Bold), ForeColor = Color.FromArgb(24, 73, 120), AutoSize = true, Location = new Point(18, 12) });
        keyStatus = new Label { Text = "私钥：未导入", AutoSize = true, ForeColor = Color.DarkRed, Location = new Point(20, 43) }; header.Controls.Add(keyStatus);
        var import = new Button { Text = "导入发行私钥", AutoSize = true, Location = new Point(850, 17) }; import.Click += ImportKey; header.Controls.Add(import); root.Controls.Add(header, 0, 0);
        var form = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 4, RowCount = 5, Padding = new Padding(4) };
        form.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 105)); form.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50)); form.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 105)); form.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        AddField(form, "* 客户名称", out customerBox, 0, 0); AddField(form, "公司", out companyBox, 2, 0); AddField(form, "* 机器码", out machineBox, 0, 1); AddField(form, "联系方式", out contactBox, 2, 1); AddField(form, "* 授权编号", out licenseIdBox, 0, 2); AddField(form, "* 到期时间", out expiryPicker, 2, 2); expiryPicker.Format = DateTimePickerFormat.Custom; expiryPicker.CustomFormat = "yyyy-MM-dd HH:mm:ss"; expiryPicker.Value = DateTime.Now.AddDays(1); AddField(form, "备注", out notesBox, 0, 3); notesBox.Multiline = true; notesBox.Height = 48;
        var buttons = new FlowLayoutPanel { Dock = DockStyle.Fill, AutoSize = true }; var oneDay = new Button { Text = "快速设为 1 天", AutoSize = true }; oneDay.Click += (_, _) => expiryPicker.Value = DateTime.Now.AddDays(1); var generate = new Button { Text = "生成激活码", AutoSize = true, BackColor = Color.FromArgb(42, 125, 190), ForeColor = Color.White, FlatStyle = FlatStyle.Flat }; generate.Click += Generate; var copy = new Button { Text = "复制激活码", AutoSize = true }; copy.Click += (_, _) => CopyOutput(); buttons.Controls.Add(oneDay); buttons.Controls.Add(generate); buttons.Controls.Add(copy); form.Controls.Add(buttons, 1, 4); form.SetColumnSpan(buttons, 3); resultStatus = new Label { Text = "填写客户信息后生成。", AutoSize = true, ForeColor = Color.DimGray, Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft }; form.Controls.Add(resultStatus, 0, 4); root.Controls.Add(form, 0, 1);
        var split = new SplitContainer { Dock = DockStyle.Fill, Orientation = Orientation.Horizontal, SplitterDistance = 82 }; outputBox = new TextBox { Dock = DockStyle.Fill, Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, Font = new Font(FontFamily.GenericMonospace, 9), PlaceholderText = "生成后的激活码会显示在这里" }; split.Panel1.Controls.Add(outputBox); grid = new DataGridView { Dock = DockStyle.Fill, ReadOnly = true, AllowUserToAddRows = false, AutoGenerateColumns = false, SelectionMode = DataGridViewSelectionMode.FullRowSelect, MultiSelect = false }; foreach (var (name, headerText, width) in new[] { ("Customer", "客户", 130), ("MachineId", "机器码", 235), ("LicenseId", "授权编号", 150), ("IssuedAt", "签发时间", 145), ("ExpiresAt", "到期时间", 145), ("Status", "状态", 80) }) grid.Columns.Add(new DataGridViewTextBoxColumn { Name = name, HeaderText = headerText, DataPropertyName = name, Width = width }); grid.CellDoubleClick += (_, e) => { if (e.RowIndex >= 0 && grid.Rows[e.RowIndex].DataBoundItem is LicenseRow row) ShowRecord(row.Data); }; split.Panel2.Controls.Add(grid); root.Controls.Add(split, 0, 2);
    }
    private static void AddField(TableLayoutPanel panel, string label, out TextBox box, int col, int row) { panel.Controls.Add(new Label { Text = label, AutoSize = true, Anchor = AnchorStyles.Left, ForeColor = label.StartsWith("*") ? Color.DarkRed : Color.DimGray, Padding = new Padding(0, 7, 0, 0) }, col, row); box = new TextBox { Dock = DockStyle.Fill }; panel.Controls.Add(box, col + 1, row); }
    private static void AddField(TableLayoutPanel panel, string label, out DateTimePicker picker, int col, int row) { panel.Controls.Add(new Label { Text = label, AutoSize = true, Anchor = AnchorStyles.Left, ForeColor = Color.DarkRed, Padding = new Padding(0, 7, 0, 0) }, col, row); picker = new DateTimePicker { Dock = DockStyle.Fill }; panel.Controls.Add(picker, col + 1, row); }
    private void ImportKey(object? sender, EventArgs e) { using var dialog = new OpenFileDialog { Filter = "密钥文件 (*.pem;*.json)|*.pem;*.json|所有文件|*.*", Title = "选择发行私钥（PEM 或 JWK JSON）" }; if (dialog.ShowDialog(this) != DialogResult.OK) return; try { var key = ReadKey(File.ReadAllText(dialog.FileName)); SaveProtectedKey(key); signingKey?.Dispose(); signingKey = key; keyStatus.Text = "私钥：已加密保存（DPAPI）"; keyStatus.ForeColor = Color.DarkGreen; MessageBox.Show(this, "私钥已导入并使用 Windows DPAPI 加密保存。", "完成", MessageBoxButtons.OK, MessageBoxIcon.Information); } catch (Exception ex) { MessageBox.Show(this, "私钥导入失败：" + ex.Message, "错误", MessageBoxButtons.OK, MessageBoxIcon.Error); } }
    private static ECDsa ReadKey(string text) { var key = ECDsa.Create(); text = text.Trim(); if (text.StartsWith("{")) { using var doc = JsonDocument.Parse(text); var root = doc.RootElement; if (root.GetProperty("kty").GetString() != "EC" || root.GetProperty("crv").GetString() != "P-256") throw new InvalidOperationException("仅支持 EC P-256 私钥。"); key.ImportParameters(new ECParameters { Curve = ECCurve.NamedCurves.nistP256, Q = new ECPoint { X = B64(root.GetProperty("x").GetString()!), Y = B64(root.GetProperty("y").GetString()!) }, D = B64(root.GetProperty("d").GetString()!) }); } else key.ImportFromPem(text); return key; }
    private static byte[] B64(string s) { s = s.Replace('-', '+').Replace('_', '/'); while (s.Length % 4 != 0) s += "="; return Convert.FromBase64String(s); }
    private void SaveProtectedKey(ECDsa key) { Directory.CreateDirectory(dataDir); var blob = ProtectedData.Protect(key.ExportPkcs8PrivateKey(), null, DataProtectionScope.CurrentUser); File.WriteAllBytes(keyFile, blob); }
    private void LoadProtectedKey() { try { if (!File.Exists(keyFile)) return; var key = ECDsa.Create(); key.ImportPkcs8PrivateKey(ProtectedData.Unprotect(File.ReadAllBytes(keyFile), null, DataProtectionScope.CurrentUser), out _); signingKey = key; keyStatus.Text = "私钥：已加密保存（DPAPI）"; keyStatus.ForeColor = Color.DarkGreen; } catch { keyStatus.Text = "私钥：加密文件无法读取，请重新导入"; } }
    private void Generate(object? sender, EventArgs e) { try { if (signingKey is null) throw new InvalidOperationException("请先导入发行私钥。"); var customer = customerBox.Text.Trim(); var machine = NormalizeMachine(machineBox.Text); var id = licenseIdBox.Text.Trim(); var expires = expiryPicker.Value; if (string.IsNullOrWhiteSpace(customer)) throw new InvalidOperationException("客户名称不能为空。"); if (!Guid.TryParse(machine, out _)) throw new InvalidOperationException("机器码格式不正确，请粘贴插件显示的 32 位十六进制机器码。"); if (string.IsNullOrWhiteSpace(id)) throw new InvalidOperationException("授权编号不能为空。"); if (expires <= DateTime.Now) throw new InvalidOperationException("到期时间必须晚于当前时间。"); var issued = DateTimeOffset.Now; var payload = new LicensePayload { Product = Product, LicenseId = id, MachineId = machine, IssuedAt = issued.ToUnixTimeMilliseconds(), ExpiresAt = new DateTimeOffset(expires).ToUnixTimeMilliseconds() }; var payloadJson = JsonSerializer.Serialize(payload, JsonOptions); var payloadPart = Base64Url(Encoding.UTF8.GetBytes(payloadJson)); var sig = signingKey.SignData(Encoding.UTF8.GetBytes(payloadPart), HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation); var token = payloadPart + "." + Base64Url(sig); var record = new LicenseRecord { Customer = customer, Company = companyBox.Text.Trim(), Contact = contactBox.Text.Trim(), MachineId = machine, LicenseId = id, IssuedAt = issued, ExpiresAt = new DateTimeOffset(expires), Notes = notesBox.Text.Trim(), Token = token }; records.RemoveAll(r => r.MachineId.Equals(machine, StringComparison.OrdinalIgnoreCase) && r.LicenseId.Equals(id, StringComparison.OrdinalIgnoreCase)); records.Insert(0, record); SaveRecords(); RefreshGrid(); outputBox.Text = token; resultStatus.Text = $"已生成：{customer}，到期 {record.ExpiresAt.LocalDateTime:yyyy-MM-dd HH:mm:ss}"; resultStatus.ForeColor = Color.DarkGreen; } catch (Exception ex) { resultStatus.Text = ex.Message; resultStatus.ForeColor = Color.DarkRed; } }
    private static string NormalizeMachine(string value) { var compact = new string(value.Where(Uri.IsHexDigit).ToArray()).ToLowerInvariant(); if (compact.Length != 32) return value.Trim().ToLowerInvariant(); return $"{compact[..8]}-{compact[8..12]}-{compact[12..16]}-{compact[16..20]}-{compact[20..]}"; }
    private static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    private void CopyOutput() { if (string.IsNullOrWhiteSpace(outputBox.Text)) return; try { Clipboard.SetText(outputBox.Text); resultStatus.Text = "激活码已复制。"; } catch (Exception ex) { resultStatus.Text = "复制失败：" + ex.Message; } }
    private void ShowRecord(LicenseRecord r) { customerBox.Text = r.Customer; companyBox.Text = r.Company; contactBox.Text = r.Contact; machineBox.Text = r.MachineId; licenseIdBox.Text = r.LicenseId; expiryPicker.Value = r.ExpiresAt.LocalDateTime > DateTimePicker.MinimumDateTime ? r.ExpiresAt.LocalDateTime : DateTime.Now.AddDays(1); notesBox.Text = r.Notes; outputBox.Text = r.Token; }
    private void LoadRecords() { try { if (File.Exists(recordsFile)) records = JsonSerializer.Deserialize<List<LicenseRecord>>(File.ReadAllText(recordsFile), JsonOptions) ?? new(); RefreshGrid(); } catch { MessageBox.Show(this, "客户记录文件损坏，请检查：" + recordsFile, "读取失败", MessageBoxButtons.OK, MessageBoxIcon.Warning); } }
    private void SaveRecords() { Directory.CreateDirectory(dataDir); var temp = recordsFile + ".tmp"; File.WriteAllText(temp, JsonSerializer.Serialize(records, JsonOptions), Encoding.UTF8); File.Move(temp, recordsFile, true); }
    private void RefreshGrid() { if (grid is null) return; grid.DataSource = records.Select(r => new LicenseRow(r)).ToList(); }
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true, PropertyNameCaseInsensitive = true, DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull };
    private sealed class LicensePayload { [JsonPropertyName("product")] public string Product { get; set; } = ""; [JsonPropertyName("licenseId")] public string LicenseId { get; set; } = ""; [JsonPropertyName("machineId")] public string MachineId { get; set; } = ""; [JsonPropertyName("issuedAt")] public long IssuedAt { get; set; } [JsonPropertyName("expiresAt")] public long ExpiresAt { get; set; } }
    private sealed class LicenseRecord { public string Customer { get; set; } = ""; public string Company { get; set; } = ""; public string Contact { get; set; } = ""; public string MachineId { get; set; } = ""; public string LicenseId { get; set; } = ""; public DateTimeOffset IssuedAt { get; set; } public DateTimeOffset ExpiresAt { get; set; } public string Notes { get; set; } = ""; public string Token { get; set; } = ""; }
    private sealed class LicenseRow { public string Customer { get; } public string MachineId { get; } public string LicenseId { get; } public string IssuedAt { get; } public string ExpiresAt { get; } public string Status { get; } public LicenseRecord Data { get; } public LicenseRow(LicenseRecord r) { Data = r; Customer = r.Customer; MachineId = r.MachineId; LicenseId = r.LicenseId; IssuedAt = r.IssuedAt.LocalDateTime.ToString("yyyy-MM-dd HH:mm"); ExpiresAt = r.ExpiresAt.LocalDateTime.ToString("yyyy-MM-dd HH:mm"); Status = r.ExpiresAt > DateTimeOffset.Now ? "有效" : "已过期"; } }
}
