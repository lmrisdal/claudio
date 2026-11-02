using System.Text;

namespace Claudio.Core.Runtime;

internal static class LaunchArguments
{
    public static List<string> Parse(string parameters)
    {
        var arguments = new List<string>();
        var argument = new StringBuilder();
        char? quote = null;
        var started = false;
        var runes = parameters.EnumerateRunes().ToList();
        for (var index = 0; index < runes.Count; index++)
        {
            var rune = runes[index];
            var next = index + 1 < runes.Count ? runes[index + 1] : (Rune?)null;
            if (rune.Value == '\\' && quote != '\''
                && next is { } following
                && (following.Value == '"' || following.Value == '\\' || (quote is null && Rune.IsWhiteSpace(following))))
            {
                argument.Append(following.ToString());
                index++;
                started = true;
            }
            else if ((rune.Value == '\'' || rune.Value == '"') && quote is null)
            {
                quote = (char)rune.Value;
                started = true;
            }
            else if (quote is { } open && rune.Value == open)
            {
                quote = null;
            }
            else if (Rune.IsWhiteSpace(rune) && quote is null)
            {
                if (started)
                {
                    arguments.Add(argument.ToString());
                    argument.Clear();
                    started = false;
                }
            }
            else
            {
                argument.Append(rune.ToString());
                started = true;
            }
        }

        if (quote is not null)
        {
            throw new CommandException("Launch parameters contain an unclosed quote.");
        }

        if (started)
        {
            arguments.Add(argument.ToString());
        }

        return arguments;
    }
}
