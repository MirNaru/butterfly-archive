using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

internal sealed class ButterflyAdmin : Form
{
    private readonly string root = AppDomain.CurrentDomain.BaseDirectory;
    private readonly TextBox log = new TextBox();
    private readonly Label[] dots = new Label[4];
    private readonly Label[] states = new Label[4];
    private readonly Button[] buttons = new Button[4];
    private readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();
    private readonly string[] commands = { "pc", "viewer", "mobile", "certificate" };
    private bool busy;
    private bool viewerRunning;

    [STAThread]
    private static void Main()
    {
        bool first;
        using (var instance = new Mutex(true, "Local\\ButterflyArchiveAdmin", out first))
        {
            if (!first) return;
            Application.EnableVisualStyles();
            Application.Run(new ButterflyAdmin());
        }
    }

    private ButterflyAdmin()
    {
        Text = "Butterfly Archive 관리자";
        MinimumSize = new Size(820, 495);
        Size = new Size(1020, 590);
        Font = new Font("맑은 고딕", 10);
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, Padding = new Padding(16) };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 58));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 42));
        Controls.Add(layout);
        log.Multiline = true;
        log.ReadOnly = true;
        log.ScrollBars = ScrollBars.Vertical;
        log.Dock = DockStyle.Fill;
        log.AccessibleName = "실행 로그";
        layout.Controls.Add(log, 0, 0);
        var controls = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 4, Padding = new Padding(12,0,0,0) };
        layout.Controls.Add(controls, 1, 0);
        string[] titles = { "PC 입력 서버 실행", "읽기 전용 서버 실행 · 사본 갱신", "모바일 연동 서버 실행", "인증서 갱신 확인" };
        for (int i = 0; i < titles.Length; i++)
        {
            int index = i;
            controls.RowStyles.Add(new RowStyle(SizeType.Percent, i == 3 ? 34 : 22));
            var row = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 2 };
            row.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 25));
            row.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            row.RowStyles.Add(new RowStyle(SizeType.Absolute, 35));
            row.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            buttons[i] = new Button { Text = titles[i], Dock = DockStyle.Fill };
            buttons[i].Click += async delegate { await Execute(index); };
            row.Controls.Add(buttons[i], 0, 0);
            row.SetColumnSpan(buttons[i], 2);
            dots[i] = new Label { Text = "●", ForeColor = Color.DarkGoldenrod, Dock = DockStyle.Fill };
            states[i] = new Label { Text = "상태 확인 중", Dock = DockStyle.Fill };
            row.Controls.Add(dots[i], 0, 1);
            row.Controls.Add(states[i], 1, 1);
            controls.Controls.Add(row, 0, i);
        }
        timer.Interval = 15000;
        timer.Tick += async delegate { await Execute(-1); };
        Shown += async delegate { timer.Start(); await Execute(-1); };
        FormClosing += delegate(object sender, FormClosingEventArgs e) {
            if (busy && buttons[0].Enabled == false) e.Cancel = true;
        };
    }

    private void Display(int index, string color, string message)
    {
        dots[index].ForeColor = color == "green" ? Color.ForestGreen : color == "yellow" ? Color.DarkGoldenrod : Color.Firebrick;
        states[index].Text = message;
    }

    private async Task Execute(int index)
    {
        if (busy) return;
        busy = true;
        try
        {
            if (index >= 0)
            {
                foreach (var button in buttons) button.Enabled = false;
                bool stoppingViewer = index == 1 && viewerRunning;
                Display(index, "yellow", index == 3 ? "확인 중" : stoppingViewer ? "끄는 중" : "켜는 중");
                Append(buttons[index].Text);
                try
                {
                    Append(await Task.Run(() => Run(stoppingViewer ? "viewer-stop" : commands[index])));
                }
                catch (Exception error)
                {
                    Append(error.Message);
                }
            }
            await RefreshStatus();
        }
        catch (Exception error)
        {
            Append(error.Message);
            Display(1, "yellow", "읽기 전용 서버 상태 확인 실패");
        }
        finally
        {
            busy = false;
            foreach (var button in buttons) button.Enabled = true;
        }
    }

    private async Task RefreshStatus()
    {
        string output = await Task.Run(() => Run("status"));
        if (IsDisposed) return;
        var lines = output.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
        if (lines.Length != states.Length) throw new InvalidOperationException("서버 상태를 읽지 못했습니다.");
        for (int i = 0; i < lines.Length; i++)
        {
            var fields = lines[i].Split(new[] { '|' }, 2);
            if (fields.Length != 2) throw new InvalidOperationException("서버 상태 형식이 올바르지 않습니다.");
            Display(i, fields[0], fields[1]);
            if (i == 1)
            {
                viewerRunning = fields[0] == "green" || fields[0] == "yellow";
                buttons[i].Text = viewerRunning ? "읽기 전용 서버 종료" : "읽기 전용 서버 실행 · 사본 갱신";
            }
        }
    }

    private void Append(string message)
    {
        if (IsDisposed || String.IsNullOrWhiteSpace(message)) return;
        log.AppendText(DateTime.Now.ToString("HH:mm:ss") + "  " + message.Trim() + Environment.NewLine);
    }

    private string Run(string command)
    {
        var info = new ProcessStartInfo(Path.Combine(root, "backend", ".venv", "Scripts", "python.exe"),
            "\"" + Path.Combine(root, "admin_manager.py") + "\" " + command) {
            WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardOutput = true, RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8
        };
        using (var process = Process.Start(info))
        {
            var output = process.StandardOutput.ReadToEndAsync();
            var errors = process.StandardError.ReadToEndAsync();
            if (!process.WaitForExit(220000))
            {
                process.Kill();
                throw new TimeoutException("관리 작업의 응답 시간이 초과됐습니다.");
            }
            Task.WaitAll(output, errors);
            if (process.ExitCode != 0) throw new InvalidOperationException(output.Result + errors.Result);
            return output.Result;
        }
    }
}
