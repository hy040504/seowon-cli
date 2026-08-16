// seowon-gui.exe — 같은 폴더의 PyQt 화면을 띄운다
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
#include <windows.h>
#endif

#ifdef _WIN32
static void exe_dir(char *out, size_t outsz)
{
    char path[MAX_PATH];
    char *slash;
    DWORD n = GetModuleFileNameA(NULL, path, MAX_PATH);
    if (n == 0) {
        strncpy(out, ".", outsz - 1);
        out[outsz - 1] = 0;
        return;
    }
    slash = strrchr(path, '\\');
    if (slash) *slash = 0;
    strncpy(out, path, outsz - 1);
    out[outsz - 1] = 0;
}

static int file_exists(const char *path)
{
    DWORD a = GetFileAttributesA(path);
    return a != INVALID_FILE_ATTRIBUTES && !(a & FILE_ATTRIBUTE_DIRECTORY);
}

static int find_python(char *out, size_t outsz)
{
    char tmp[MAX_PATH];
    DWORD n;

    n = SearchPathA(NULL, "python.exe", NULL, MAX_PATH, tmp, NULL);
    if (n > 0 && n < MAX_PATH && file_exists(tmp) && strstr(tmp, "WindowsApps") == NULL) {
        strncpy(out, tmp, outsz - 1);
        out[outsz - 1] = 0;
        return 1;
    }

    n = GetEnvironmentVariableA("LOCALAPPDATA", tmp, MAX_PATH);
    if (n > 0 && n < MAX_PATH) {
        char try_path[MAX_PATH];
        snprintf(try_path, sizeof(try_path), "%s\\Programs\\Python\\Python312\\python.exe", tmp);
        if (file_exists(try_path)) {
            strncpy(out, try_path, outsz - 1);
            out[outsz - 1] = 0;
            return 1;
        }
        snprintf(try_path, sizeof(try_path), "%s\\Programs\\Python\\Python313\\python.exe", tmp);
        if (file_exists(try_path)) {
            strncpy(out, try_path, outsz - 1);
            out[outsz - 1] = 0;
            return 1;
        }
        snprintf(try_path, sizeof(try_path), "%s\\Programs\\Python\\Python311\\python.exe", tmp);
        if (file_exists(try_path)) {
            strncpy(out, try_path, outsz - 1);
            out[outsz - 1] = 0;
            return 1;
        }
    }

    strncpy(out, "python", outsz - 1);
    out[outsz - 1] = 0;
    return 0;
}

static void show_err(const char *msg)
{
    MessageBoxA(NULL, msg, "seowon-gui", MB_OK | MB_ICONERROR);
    fprintf(stderr, "%s\n", msg);
}
#endif

int main(int argc, char **argv)
{
#ifdef _WIN32
    char dir[MAX_PATH];
    char script[MAX_PATH];
    char py[MAX_PATH];
    char cmd[4096];
    char err[1024];
    int i;
    int rc;

    exe_dir(dir, sizeof(dir));
    SetCurrentDirectoryA(dir);

    snprintf(script, sizeof(script), "%s\\lib\\front\\gui\\main.py", dir);
    if (!file_exists(script)) {
        snprintf(err, sizeof(err), "화면 파일을 찾지 못했습니다.\n%s", script);
        show_err(err);
        return 1;
    }

    find_python(py, sizeof(py));
    snprintf(cmd, sizeof(cmd), "\"%s\" \"%s\"", py, script);
    for (i = 1; i < argc; i++) {
        size_t n = strlen(cmd);
        snprintf(cmd + n, sizeof(cmd) - n, " %s", argv[i]);
    }

    rc = system(cmd);
    if (rc != 0) {
        snprintf(err, sizeof(err),
                 "GUI 를 시작하지 못했습니다. (코드 %d)\n\n"
                 "1) pip install -r requirements.txt\n"
                 "2) python lib\\front\\gui\\main.py\n\n%s",
                 rc, cmd);
        show_err(err);
        return rc == -1 ? 1 : rc;
    }
    return 0;
#else
    (void)argc;
    (void)argv;
    fprintf(stderr, "Windows 전용입니다.\n");
    return 1;
#endif
}
