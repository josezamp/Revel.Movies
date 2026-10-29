using RevelMovies.Application.Media;

namespace RevelMovies.Infrastructure.Media;

// Cleanup never follows directory junctions or symbolic links out of managed storage.
public sealed class MediaDirectory(string rootPath)
{
    private readonly string root = Path.GetFullPath(rootPath);

    public string Resolve(string key)
    {
        var path = Path.GetFullPath(Path.Combine(root, key.Replace('/', Path.DirectorySeparatorChar)));
        var comparison = OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
        if (!path.StartsWith(root.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, comparison))
            throw new IOException("La ruta está fuera del almacenamiento de archivos.");
        for (var current = path; current is not null; current = Path.GetDirectoryName(current))
        {
            if (TryGetAttributes(current, out var attributes) && (attributes & FileAttributes.ReparsePoint) != 0)
                throw new IOException("La limpieza no admite enlaces ni uniones de directorios.");
        }
        return path;
    }

    public IReadOnlyList<MediaStorageFile> ListFiles(string directory)
    {
        var files = new List<MediaStorageFile>();
        Visit(Resolve(directory));
        return files;

        void Visit(string path)
        {
            if (!TryGetAttributes(path, out var attributes)) return;
            if ((attributes & FileAttributes.Directory) == 0) throw new IOException("La carpeta de archivos no es un directorio.");
            foreach (var entry in Directory.EnumerateFileSystemEntries(path))
            {
                var key = Path.GetRelativePath(root, entry).Replace('\\', '/');
                Resolve(key);
                if ((File.GetAttributes(entry) & FileAttributes.Directory) != 0) Visit(entry);
                else
                {
                    var info = new FileInfo(entry);
                    files.Add(new(key, info.Length, info.LastWriteTimeUtc.Ticks));
                }
            }
        }
    }

    public void DeleteFile(string key) => File.Delete(Resolve(key));

    public void RemoveEmptyDirectories(string directory)
    {
        var path = Resolve(directory);
        if (!TryGetAttributes(path, out var attributes)) return;
        if ((attributes & FileAttributes.Directory) == 0) throw new IOException("La carpeta de archivos no es un directorio.");
        foreach (var child in Directory.EnumerateDirectories(path))
            RemoveEmptyDirectories(Path.GetRelativePath(root, child));
        if (!Directory.EnumerateFileSystemEntries(path).Any()) Directory.Delete(path);
    }

    private static bool TryGetAttributes(string path, out FileAttributes attributes)
    {
        // Exists() hides permission errors. An unreadable folder must never be treated as empty.
        try { attributes = File.GetAttributes(path); return true; }
        catch (FileNotFoundException) { attributes = default; return false; }
        catch (DirectoryNotFoundException) { attributes = default; return false; }
    }
}
