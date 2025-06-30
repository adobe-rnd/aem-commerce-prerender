#!/bin/bash
    
echo "checking poller run state..."
running_state=$(aio app state get running)
if [ "$running_state" = "true" ]; then
    echo "poller mutex is set to true, resetting to false" && \
    aio app state put running false
else
    echo "poller is not running (state: $running_state)"
fi
rm -r dist/
aio app deploy && \
echo "app deployed!"