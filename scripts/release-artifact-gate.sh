#!/usr/bin/env bash
# Decide whether this Release workflow run may upload alchemy.new.tar.gz.
#
# A GitHub Release named by VERSION is not enough. v1.8.0 already exists, and
# the first master run after this change still has that version. Uploading
# the current checkout would attach a later commit to that release.
#
# published: this run may upload only when the tag commit is HEAD and the
# release was published at or after this workflow run was created.
# assert-tag: the checkout, the recorded publish commit, and the live tag
# commit are the same SHA.

set -euo pipefail

usage() {
  printf 'Usage: release-artifact-gate.sh published|assert-tag arguments\n' >&2
  exit 2
}

is_sha() {
  [[ "$1" =~ ^[0-9a-f]{40}$ ]]
}

epoch() {
  local value="$1"
  if [[ -z "$value" ]]; then
    return 1
  fi
  date -u -d "$value" +%s
}

published_decision() {
  local head_sha="$1"
  local tag_sha="$2"
  local published_at="$3"
  local run_created_at="$4"
  local published_epoch run_epoch

  if ! is_sha "$head_sha" || ! is_sha "$tag_sha"; then
    printf 'false\n'
    return 0
  fi
  if [[ "$head_sha" != "$tag_sha" ]]; then
    printf 'false\n'
    return 0
  fi
  if ! published_epoch="$(epoch "$published_at")" || ! run_epoch="$(epoch "$run_created_at")"; then
    printf 'false\n'
    return 0
  fi
  if (( published_epoch < run_epoch )); then
    printf 'false\n'
    return 0
  fi
  printf 'true\n'
}

assert_tag() {
  local head_sha="$1"
  local expected_sha="$2"
  local live_tag_sha="$3"

  if ! is_sha "$head_sha" || ! is_sha "$expected_sha" || ! is_sha "$live_tag_sha"; then
    printf 'Refusing to pack: release commit SHA is missing or malformed.\n' >&2
    exit 1
  fi
  if [[ "$head_sha" != "$expected_sha" || "$live_tag_sha" != "$expected_sha" ]]; then
    printf 'Refusing to pack: checkout %s, recorded release commit %s, live tag %s.\n' \
      "$head_sha" "$expected_sha" "$live_tag_sha" >&2
    exit 1
  fi
}

if [[ $# -lt 1 ]]; then
  usage
fi

command="$1"
shift

case "$command" in
  published)
    if [[ $# -ne 4 ]]; then
      usage
    fi
    published_decision "$@"
    ;;
  assert-tag)
    if [[ $# -ne 3 ]]; then
      usage
    fi
    assert_tag "$@"
    ;;
  *)
    usage
    ;;
esac
