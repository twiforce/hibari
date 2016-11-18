#!/bin/sh
PATH='/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin:/root/bin'

n=`ps auxwww|grep "node index.js"|grep -v grep|wc -l`
if [ $n -eq 0 ]
then
	cd /home/synch/synchtube.ru
	node index.js
	echo `date` >> fuckyou.log
fi