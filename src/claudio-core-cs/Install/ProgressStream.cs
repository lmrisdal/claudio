using System.Diagnostics;

namespace Claudio.Core.Install;

internal sealed class ProgressStream(Stream inner, InstallControl control, Action<double> callback) : Stream
{
    private readonly Stopwatch lastReport = Stopwatch.StartNew();
    private long bytesRead;

    public override bool CanRead => true;
    public override bool CanSeek => false;
    public override bool CanWrite => false;
    public override long Length => inner.Length;

    public override long Position
    {
        get => inner.Position;
        set => throw new NotSupportedException();
    }

    public override int Read(byte[] buffer, int offset, int count) => Read(buffer.AsSpan(offset, count));

    public override int Read(Span<byte> buffer)
    {
        if (control.IsCancelled)
        {
            throw new OperationCanceledException();
        }

        var read = inner.Read(buffer);
        bytesRead += read;
        if (lastReport.ElapsedMilliseconds > 100)
        {
            if (inner.Length > 0)
            {
                callback(bytesRead / (double)inner.Length);
            }

            lastReport.Restart();
        }

        return read;
    }

    public override void Flush()
    {
    }

    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

    public override void SetLength(long value) => throw new NotSupportedException();

    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            inner.Dispose();
        }

        base.Dispose(disposing);
    }
}
