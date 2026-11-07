package org.firstinspires.ftc.robotcore.internal.opmode;

import com.qualcomm.robotcore.eventloop.opmode.OpMode;
import com.qualcomm.robotcore.eventloop.opmode.OpModeManager;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Desktop stand-in for the Robot Controller's OpMode registry, for the virtual hub only.
 *
 * <p>On a hub the SDK fills this registry by scanning the APK, and the SDK class cannot initialize on a
 * desktop JVM (it loads the hub's native library and Android string resources). This class shadows it
 * on the virtual hub's test class path only, where test classes come first. It holds real
 * {@link OpModeMeta} objects built with the SDK's own builder, and, like the SDK's registry, it lists
 * the SDK's system OpMode ({@value OpModeManager#DEFAULT_OP_MODE_NAME}), which the robot library must
 * filter out. Only the members the robot library and the harness use are provided.
 */
public class RegisteredOpModes implements OpModeManager {
    public static final OpModeMeta DEFAULT_OP_MODE_METADATA = new OpModeMeta.Builder()
            .setName(DEFAULT_OP_MODE_NAME)
            .setFlavor(OpModeMeta.Flavor.SYSTEM)
            .setSystemOpModeBaseDisplayName("Stop Robot")
            .build();

    private static final RegisteredOpModes INSTANCE = new RegisteredOpModes();

    private final Map<String, OpModeMeta> opModes = new ConcurrentHashMap<>();
    private final Map<String, Class<? extends OpMode>> classes = new ConcurrentHashMap<>();

    public static RegisteredOpModes getInstance() {
        return INSTANCE;
    }

    public RegisteredOpModes() {
        opModes.put(DEFAULT_OP_MODE_METADATA.name, DEFAULT_OP_MODE_METADATA);
    }

    /** Registration happens before the virtual hub starts, so there is nothing to wait for. */
    public void waitOpModesRegistered() {
    }

    public List<OpModeMeta> getOpModes() {
        return new ArrayList<>(opModes.values());
    }

    public OpModeMeta getOpModeMetadata(String name) {
        return opModes.get(name);
    }

    @Override
    public void register(String name, Class<? extends OpMode> opMode) {
        register(new OpModeMeta.Builder().setName(name).build(), opMode);
    }

    @Override
    public void register(OpModeMeta meta, Class<? extends OpMode> opMode) {
        opModes.put(meta.name, meta);
        classes.put(meta.name, opMode);
    }

    @Override
    public void register(String name, OpMode opMode) {
        register(new OpModeMeta.Builder().setName(name).build(), opMode.getClass());
    }

    @Override
    public void register(OpModeMeta meta, OpMode opMode) {
        register(meta, opMode.getClass());
    }
}
