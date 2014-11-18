#!/bin/sh

find /usr/local/tomcat/logs -mtime +1 | grep -v bz2 |xargs --no-run-if-empty nice bzip2
find /usr/local/tomcat/logs -mtime +60 | xargs --no-run-if-empty rm
