#include <errno.h>
#include <spawn.h>
#include <stdio.h>
#include <sys/wait.h>
#include <unistd.h>

extern char **environ;

static int fork_errno(void) {
  errno = 0;
  pid_t pid = fork();
  if (pid == 0) _exit(70);
  if (pid < 0) return errno;
  int status = 0;
  (void)waitpid(pid, &status, 0);
  return 0;
}

static int vfork_errno(void) {
  errno = 0;
  pid_t pid = vfork();
  if (pid == 0) _exit(71);
  if (pid < 0) return errno;
  int status = 0;
  (void)waitpid(pid, &status, 0);
  return 0;
}

int main(void) {
  char *args[] = {"true", NULL};
  pid_t spawned = -1;
  int spawn_result = posix_spawn(&spawned, "/usr/bin/true", NULL, NULL, args, environ);
  if (spawn_result == 0) {
    int status = 0;
    (void)waitpid(spawned, &status, 0);
  }
  spawned = -1;
  int spawnp_result = posix_spawnp(&spawned, "true", NULL, NULL, args, environ);
  if (spawnp_result == 0) {
    int status = 0;
    (void)waitpid(spawned, &status, 0);
  }
  printf(
    "{\"schemaVersion\":1,\"pid\":%d,\"parentPid\":%d,"
    "\"forkErrno\":%d,\"vforkErrno\":%d,"
    "\"posixSpawnResult\":%d,\"posixSpawnpResult\":%d}\n",
    getpid(), getppid(), fork_errno(), vfork_errno(), spawn_result, spawnp_result
  );
  return 0;
}
