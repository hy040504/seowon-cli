// seowon-gui.exe — pythonw 로 PyQt 화면을 띄운다 (cmd/system 따옴표 문제 없음)
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
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

static void to_pythonw(char *path)
{
    char *name = strrchr(path, '\\');
    name = name ? name + 1 : path;
    if (_stricmp(name, "python.exe") == 0) {
        name[6] = 'w'; /* pythonw.exe */
        if (!file_exists(path)) {
            memcpy(name, "python.exe", 11);
        }
    }
}

static int find_python(char *out, size_t outsz)
{
    char tmp[MAX_PATH];
    DWORD n;
    const char *ver[] = {"Python313", "Python312", "Python311", "Python310", NULL};
    int i;

    n = GetEnvironmentVariableA("LOCALAPPDATA", tmp, MAX_PATH);
    if (n > 0 && n < MAX_PATH) {
        for (i = 0; ver[i]; i++) {
            char try_path[MAX_PATH];
            snprintf(try_path, sizeof(try_path), "%s\\Programs\\Python\\%s\\pythonw.exe", tmp, ver[i]);
            if (file_exists(try_path)) {
                strncpy(out, try_path, outsz - 1);
                out[outsz - 1] = 0;
                return 1;
            }
            snprintf(try_path, sizeof(try_path), "%s\\Programs\\Python\\%s\\python.exe", tmp, ver[i]);
            if (file_exists(try_path)) {
                strncpy(out, try_path, outsz - 1);
                out[outsz - 1] = 0;
                to_pythonw(out);
                return 1;
            }
        }
    }

    n = SearchPathA(NULL, "pythonw.exe", NULL, MAX_PATH, tmp, NULL);
    if (n > 0 && n < MAX_PATH && file_exists(tmp) && strstr(tmp, "WindowsApps") == NULL) {
        strncpy(out, tmp, outsz - 1);
        out[outsz - 1] = 0;
        return 1;
    }
    n = SearchPathA(NULL, "python.exe", NULL, MAX_PATH, tmp, NULL);
    if (n > 0 && n < MAX_PATH && file_exists(tmp) && strstr(tmp, "WindowsApps") == NULL) {
        strncpy(out, tmp, outsz - 1);
        out[outsz - 1] = 0;
        to_pythonw(out);
        return 1;
    }
    return 0;
}

static void show_err(const char *msg)
{
    MessageBoxA(NULL, msg, "seowon-gui", MB_OK | MB_ICONERROR);
}

static int run_python(const char *py, char *cmdline, const char *cwd, const char *log_path)
{
    STARTUPINFOA si;
    PROCESS_INFORMATION pi;
    SECURITY_ATTRIBUTES sa;
    HANDLE log = INVALID_HANDLE_VALUE;
    DWORD code = 1;

    memset(&si, 0, sizeof(si));
    memset(&pi, 0, sizeof(pi));
    memset(&sa, 0, sizeof(sa));
    si.cb = sizeof(si);
    sa.nLength = sizeof(sa);
    sa.bInheritHandle = TRUE;

    log = CreateFileA(log_path, GENERIC_WRITE, FILE_SHARE_READ, &sa, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    if (log != INVALID_HANDLE_VALUE) {
        si.dwFlags |= STARTF_USESTDHANDLES;
        si.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
        si.hStdOutput = log;
        si.hStdError = log;
    }

    if (!CreateProcessA(py, cmdline, NULL, NULL, TRUE, CREATE_NO_WINDOW, NULL, cwd, &si, &pi)) {
        if (log != INVALID_HANDLE_VALUE) CloseHandle(log);
        return -(int)GetLastError();
    }
    WaitForSingleObject(pi.hProcess, INFINITE);
    GetExitCodeProcess(pi.hProcess, &code);
    CloseHandle(pi.hThread);
    CloseHandle(pi.hProcess);
    if (log != INVALID_HANDLE_VALUE) CloseHandle(log);
    return (int)code;
}
#endif

int main(int argc, char **argv)
{
#ifdef _WIN32
    char dir[MAX_PATH];
    char script[MAX_PATH];
    char py[MAX_PATH];
    char log_path[MAX_PATH];
    char cmd[4096];
    char err[1600];
    int i;
    int rc;

    exe_dir(dir, sizeof(dir));
    SetCurrentDirectoryA(dir);
    snprintf(log_path, sizeof(log_path), "%s\\seowon-gui.log", dir);

    snprintf(script, sizeof(script), "%s\\lib\\front\\gui\\main.py", dir);
    if (!file_exists(script)) {
        snprintf(err, sizeof(err), "화면 파일을 찾지 못했습니다.\n%s", script);
        show_err(err);
        return 1;
    }

    if (!find_python(py, sizeof(py)) || !file_exists(py)) {
        show_err("Python 을 찾지 못했습니다.\n\n"
                 "https://www.python.org 에서 Python 3 을 설치하고\n"
                 "pip install -r requirements.txt\n를 실행하세요.");
        return 1;
    }

    snprintf(cmd, sizeof(cmd), "\"%s\" \"%s\"", py, script);
    for (i = 1; i < argc; i++) {
        size_t n = strlen(cmd);
        snprintf(cmd + n, sizeof(cmd) - n, " \"%s\"", argv[i]);
    }

    rc = run_python(py, cmd, dir, log_path);
    if (rc != 0) {
        snprintf(err, sizeof(err),
                 "GUI 를 시작하지 못했습니다. (코드 %d)\n\n"
                 "같은 폴더의 seowon-gui.log 를 확인하세요.\n"
                 "pip install -r requirements.txt\n\n%s",
                 rc, py);
        show_err(err);
        return 1;
    }
    return 0;
#else
    (void)argc;
    (void)argv;
    fprintf(stderr, "Windows 전용입니다.\n");
    return 1;
#endif
}
