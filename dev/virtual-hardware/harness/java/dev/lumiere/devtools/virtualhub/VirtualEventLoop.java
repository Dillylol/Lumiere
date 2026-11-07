package dev.lumiere.devtools.virtualhub;

import com.qualcomm.ftccommon.FtcEventLoop;
import com.qualcomm.robotcore.eventloop.opmode.OpModeManagerImpl;

/**
 * The event loop handed to {@code @OnCreateEventLoop} hooks. The robot library only asks it for the
 * OpMode manager. Created with {@link #create}, never with its constructor, which needs a phone.
 */
final class VirtualEventLoop extends FtcEventLoop {
    private OpModeManagerImpl manager;

    private VirtualEventLoop() {
        super(null, null, null, null); // Never runs: see create().
    }

    static VirtualEventLoop create(OpModeManagerImpl manager) {
        VirtualEventLoop loop = Instances.withoutConstructor(VirtualEventLoop.class);
        loop.manager = manager;
        return loop;
    }

    @Override
    public OpModeManagerImpl getOpModeManager() {
        return manager;
    }
}
