// seowon-gui.exe — PyQt 화면을 띄운다
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
#include <windows.h>
#endif

static void exe_dir(char *out, size_t outsz)
{
#ifdef _WIN32
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
#else
    strncpy(out, ".", outsz - 1);
    out[outsz - 1] = 0;
#endif
}

int main(int argc, char **argv)
{
    char dir[512];
    char script[640];
    char cmd[2048];
    int i;
    FILE *fp;

    exe_dir(dir, sizeof(dir));
    snprintf(script, sizeof(script), "%s\\lib\\front\\gui\\main.py", dir);
    fp = fopen(script, "r");
    if (!fp) {
        snprintf(script, sizeof(script), "lib\\front\\gui\\main.py");
        fp = fopen(script, "r");
    }
    if (!fp) {
        fprintf(stderr, "lib/front/gui/main.py 를 찾지 못했습니다.\n");
        return 1;
    }
    fclose(fp);

    snprintf(cmd, sizeof(cmd), "python \"%s\"", script);
    for (i = 1; i < argc; i++) {
        size_t n = strlen(cmd);
        snprintf(cmd + n, sizeof(cmd) - n, " %s", argv[i]);
    }
    return system(cmd);
}
