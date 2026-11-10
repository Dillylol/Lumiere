package dev.lumiere.ftc.live;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import dev.lumiere.ftc.internal.Json;

import org.junit.Test;

import java.util.List;
import java.util.Map;

public class LiveProgramTest {
    /** A small program in the format Lumière sends: two mechanisms, an atomic and a compound path, nested groups. */
    static final String PROGRAM = "{\"format\":1,\"name\":\"Red Goal\",\"revision\":\"3f2a9c1b\","
            + "\"start\":{\"x\":110.5,\"y\":135.5,\"headingDeg\":0},"
            + "\"mechanisms\":["
            + "{\"id\":\"intake\",\"name\":\"Intake\",\"devices\":[{\"id\":\"m\",\"name\":\"Intake\",\"kind\":\"motor\",\"reversed\":true}],"
            + "\"states\":[{\"id\":\"off\",\"name\":\"Off\",\"outputs\":{\"m\":{\"kind\":\"power\",\"value\":0}}},"
            + "{\"id\":\"in\",\"name\":\"In\",\"outputs\":{\"m\":{\"kind\":\"power\",\"value\":1}}}],\"initialState\":\"off\"},"
            + "{\"id\":\"claw\",\"name\":\"Claw\",\"devices\":[{\"id\":\"s\",\"name\":\"claw\",\"kind\":\"servo\",\"reversed\":false},"
            + "{\"id\":\"t\",\"name\":\"Turret\",\"kind\":\"motor\",\"reversed\":false,\"travel\":{\"minTicks\":-200,\"maxTicks\":400}}],"
            + "\"states\":[{\"id\":\"open\",\"name\":\"Open\",\"outputs\":{\"s\":{\"kind\":\"position\",\"value\":0.8},\"t\":{\"kind\":\"target\",\"ticks\":120,\"power\":0.5}}}],\"initialState\":null}],"
            + "\"paths\":["
            + "{\"id\":\"p1\",\"name\":\"Start to Shoot\",\"kind\":\"atomic\",\"heading\":null,\"segments\":[{\"start\":{\"x\":110.5,\"y\":135.5,\"headingDeg\":0},"
            + "\"controls\":[],\"end\":{\"x\":96,\"y\":96,\"headingDeg\":45},\"heading\":{\"type\":\"linear\",\"startDeg\":0,\"endDeg\":45}}]},"
            + "{\"id\":\"p2\",\"name\":\"Row 1\",\"kind\":\"compound\",\"heading\":{\"type\":\"tangential\",\"reverse\":true},\"segments\":["
            + "{\"start\":{\"x\":96,\"y\":96,\"headingDeg\":45},\"controls\":[{\"x\":100,\"y\":80}],\"end\":{\"x\":110,\"y\":84,\"headingDeg\":10},\"heading\":null},"
            + "{\"start\":{\"x\":110,\"y\":84,\"headingDeg\":10},\"controls\":[],\"end\":{\"x\":128,\"y\":84,\"headingDeg\":0},\"heading\":null}]}],"
            + "\"routine\":[{\"kind\":\"state\",\"mechanism\":\"intake\",\"state\":\"in\"},"
            + "{\"kind\":\"together\",\"steps\":[{\"kind\":\"path\",\"path\":\"p1\"},{\"kind\":\"race\",\"steps\":[{\"kind\":\"wait\",\"ms\":1200},{\"kind\":\"state\",\"mechanism\":\"claw\",\"state\":\"open\"}]}]},"
            + "{\"kind\":\"path\",\"path\":\"p2\"}]}";

    static Map<String, Object> program() {
        return Json.parseObject(PROGRAM);
    }

    @Test
    public void readsAProgramInLumieresFormat() {
        LiveProgram.Reading reading = LiveProgram.read(program());
        assertEquals("[]", reading.problems.toString());
        LiveProgram program = reading.program;
        assertNotNull(program);
        assertEquals("Red Goal", program.name);
        assertEquals(110.5, program.start.x, 0);
        assertEquals(2, program.mechanisms.size());
        assertEquals("off", program.mechanism("intake").initialState);
        LiveProgram.Output target = program.mechanism("claw").states.get(0).outputs.get("t");
        assertEquals(120, target.ticks);
        assertEquals(0.5, target.power, 0);
        assertEquals("linear", program.paths.get(0).segments.get(0).heading.type);
        assertTrue(program.paths.get(1).compound);
        assertTrue(program.paths.get(1).heading.reverse);
        assertEquals(1, program.paths.get(1).segments.get(0).controls.size());
        assertEquals(3, program.routine.size());
        assertEquals("race", program.routine.get(1).steps.get(1).kind);
    }

    @Test
    public void listsEveryProblemInsteadOfStoppingAtTheFirst() {
        Map<String, Object> json = program();
        Map<String, Object> claw = mechanism(json, 1);
        // A servo given a power, and a target that is not whole ticks.
        Map<String, Object> outputs = Json.parseObject("{\"s\":{\"kind\":\"power\",\"value\":0.5},\"t\":{\"kind\":\"target\",\"ticks\":12.5,\"power\":0.5}}");
        state(claw, 0).put("outputs", outputs);
        json.put("routine", Json.parse("[{\"kind\":\"path\",\"path\":\"nowhere\"},{\"kind\":\"wait\",\"ms\":-5},{\"kind\":\"spin\"}]"));
        LiveProgram.Reading reading = LiveProgram.read(json);
        assertNull(reading.program);
        assertEquals(5, reading.problems.size());
        assertTrue(reading.problems.toString(), reading.problems.get(0).contains("\"claw\"") && reading.problems.get(0).contains("a servo takes a position"));
        assertTrue(reading.problems.get(1).contains("whole number of ticks"));
        assertTrue(reading.problems.get(2).contains("path the program does not have"));
        assertTrue(reading.problems.get(3).contains("wait"));
        assertTrue(reading.problems.get(4).contains("\"spin\""));
    }

    @Test
    public void refusesProgramsItCannotRead() {
        Map<String, Object> newer = program();
        newer.put("format", 2.0);
        assertTrue(LiveProgram.read(newer).problems.get(0).contains("newer robot library"));
        assertEquals("The program is missing.", LiveProgram.read(null).problems.get(0));

        Map<String, Object> offField = program();
        ((Map<String, Object>) offField.get("start")).put("x", 500.0);
        assertTrue(LiveProgram.read(offField).problems.get(0).startsWith("The start pose"));

        StringBuilder deep = new StringBuilder();
        for (int i = 0; i < 9; i++) deep.append("{\"kind\":\"together\",\"steps\":[");
        deep.append("{\"kind\":\"wait\",\"ms\":1}");
        for (int i = 0; i < 9; i++) deep.append("]}");
        Map<String, Object> nested = program();
        nested.put("routine", Json.parse("[" + deep + "]"));
        assertTrue(LiveProgram.read(nested).problems.toString().contains("nests groups more than 8 deep"));
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> mechanism(Map<String, Object> json, int index) {
        return (Map<String, Object>) ((List<Object>) json.get("mechanisms")).get(index);
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> state(Map<String, Object> mechanism, int index) {
        return (Map<String, Object>) ((List<Object>) mechanism.get("states")).get(index);
    }
}
