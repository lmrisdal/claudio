using System.Text;

namespace Claudio.Core.Install;

internal static class InstallerArguments
{
    public static List<string> Build(InstallerType type, string target, bool interactive)
    {
        var args = new List<string>();
        if (!interactive)
        {
            switch (type)
            {
                case InstallerType.InnoSetup or InstallerType.GogInnoSetup:
                    args.AddRange(["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NOSOUND"]);
                    break;
                case InstallerType.Nsis:
                    args.Add("/S");
                    break;
                case InstallerType.Msi:
                    args.Add("/qn");
                    break;
            }
        }

        switch (type)
        {
            case InstallerType.InnoSetup or InstallerType.GogInnoSetup:
                args.Add($"/DIR={target}");
                break;
            case InstallerType.Nsis:
                args.Add($"/D={target}");
                break;
            case InstallerType.Msi:
                args.Add($"TARGETDIR={target}");
                break;
        }

        return args;
    }

    public static string WindowsArgumentLine(InstallerType type, IEnumerable<string> args) =>
        string.Join(' ', args.Select(arg =>
            type == InstallerType.Nsis && arg.StartsWith("/D=", StringComparison.Ordinal) ? arg : QuoteWindowsArgument(arg)));

    internal static string QuoteWindowsArgument(string arg)
    {
        if (arg.Length > 0 && !arg.Any(ch => char.IsWhiteSpace(ch) || ch == '"'))
        {
            return arg;
        }

        var quoted = new StringBuilder("\"");
        var slashes = 0;
        foreach (var ch in arg)
        {
            if (ch == '\\')
            {
                slashes++;
                continue;
            }

            quoted.Append('\\', slashes * (ch == '"' ? 2 : 1));
            if (ch == '"')
            {
                quoted.Append('\\');
            }

            quoted.Append(ch);
            slashes = 0;
        }

        quoted.Append('\\', slashes * 2).Append('"');
        return quoted.ToString();
    }
}
